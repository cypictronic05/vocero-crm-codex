import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: {
    userId: "usr_member",
    memberId: "mem_a",
    organizationId: "org_a",
    role: "member",
  },
  conversationAllowed: false,
  contactAllowed: false,
  leadAllowed: false,
  mediaAllowed: false,
  bookingAllowed: false,
  sendAllowed: false,
  deniedReason: null as "suspended" | "outside_shift" | null,
  deniedInsideLock: null as "suspended" | "outside_shift" | null,
  assignedConversationId: "cv_owned",
  assignmentCalls: 0,
  sendCalls: 0,
  contactReads: 0,
  bookingMutations: 0,
}));

vi.mock("@/lib/auth/session", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  requireSession: async () => state.session,
}));

vi.mock("@/server/inbox/queries", () => ({
  getConversation: async () =>
    state.conversationAllowed
      ? { conversation: { id: "cv_owned" }, contact: {}, anuncio: null }
      : null,
  listMessages: async () => [],
  serializeConversation: () => ({ id: "cv_owned" }),
  updateConversation: async () => null,
}));

vi.mock("@/server/inbox/ingest", () => ({ serializeMessage: (value: unknown) => value }));

vi.mock("@/server/inbox/send", () => ({
  SendError: class SendError extends Error {},
  sendText: async () => {
    state.sendCalls += 1;
    return { messageId: "msg_1" };
  },
  sendStructured: async () => {
    state.sendCalls += 1;
    return { messageId: "msg_1" };
  },
}));

vi.mock("@/server/team/http", () => ({
  operatorSendDenied: async () =>
    state.deniedReason
      ? Response.json(
          { error: { code: state.deniedReason, message: state.deniedReason } },
          { status: 403 }
        )
      : null,
  operatorSendErrorResponse: (error: unknown) => {
    const code = (error as { code?: string })?.code;
    return code === "suspended" || code === "outside_shift"
      ? Response.json({ error: { code } }, { status: 403 })
      : null;
  },
}));

vi.mock("@/server/assignments/access", () => {
  class ConversationAccessError extends Error {}
  return {
    ConversationAccessError,
    withConversationSendLock: async (
      _session: unknown,
      _conversationId: string,
      action: () => Promise<unknown>
    ) => {
      if (state.deniedInsideLock) {
        throw Object.assign(new Error(state.deniedInsideLock), {
          code: state.deniedInsideLock,
        });
      }
      if (!state.sendAllowed) throw new ConversationAccessError("no encontrada");
      return action();
    },
    canAccessConversation: async (_session: unknown, conversationId: string) =>
      conversationId === state.assignedConversationId,
    canAccessContact: async () => state.contactAllowed,
    canAccessLead: async () => state.leadAllowed,
    canAccessMediaAsset: async () => state.mediaAllowed,
    canAccessBooking: async () => state.bookingAllowed,
    contactScope: () => ({ policy: "assigned-contact" }),
    leadScope: () => ({ policy: "assigned-lead" }),
    bookingScope: () => ({ policy: "assigned-booking" }),
  };
});

vi.mock("@/server/assignments/service", () => ({
  AssignmentError: class AssignmentError extends Error {},
  setConversationAssignment: async () => {
    state.assignmentCalls += 1;
    return { conversationId: "cv_other", toMemberId: "mem_a" };
  },
}));

vi.mock("@/server/contacts", () => ({
  getContactById: async () => {
    state.contactReads += 1;
    return { id: "ct_other" };
  },
  getContactStage: async () => null,
  serializeContact: (contact: unknown) => contact,
}));

vi.mock("@/server/attribution/store", () => ({
  anuncioDelContacto: async () => null,
  repararImagenSiFalta: () => {},
}));

vi.mock("@/server/bot/ficha", () => ({ upsertFicha: async () => ({}) }));
vi.mock("@/server/leads/stage-history", () => ({ moveLeadToStage: vi.fn() }));
vi.mock("@/server/agenda/flag", () => ({
  agendaEnabled: () => true,
  agendaDisabledResponse: () => new Response(null, { status: 404 }),
}));
vi.mock("@/server/agenda/service", () => ({
  cancelBooking: async () => {
    state.bookingMutations += 1;
  },
  markBookingStatus: async () => {
    state.bookingMutations += 1;
  },
  rescheduleBooking: async () => {
    state.bookingMutations += 1;
    return { label: "fecha" };
  },
  retryMeetingLink: async () => {
    state.bookingMutations += 1;
    return { meetingLink: null, linkPending: true };
  },
}));
vi.mock("@/server/agenda/http", () => ({
  bookingErrorResponse: (error: unknown) => {
    throw error;
  },
}));

const messagesRoute = await import("@/app/api/conversations/[id]/messages/route");
const assignmentRoute = await import("@/app/api/conversations/[id]/assignment/route");
const contactRoute = await import("@/app/api/contacts/[id]/route");
const leadRoute = await import("@/app/api/pipeline/leads/[id]/route");
const mediaRoute = await import("@/app/api/media/[assetId]/route");
const bookingRoute = await import("@/app/api/bookings/[id]/route");
const { canReceiveSseEvent } = await import("@/server/events/access");

const context = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.session.role = "member";
  state.conversationAllowed = false;
  state.contactAllowed = false;
  state.leadAllowed = false;
  state.mediaAllowed = false;
  state.bookingAllowed = false;
  state.sendAllowed = false;
  state.deniedReason = null;
  state.deniedInsideLock = null;
  state.assignmentCalls = 0;
  state.sendCalls = 0;
  state.contactReads = 0;
  state.bookingMutations = 0;
});

describe("API y URL directa", () => {
  it("responde 404 al leer mensajes de una conversación no asignada", async () => {
    const response = await messagesRoute.GET(
      new Request("http://localhost/api/conversations/cv_other/messages"),
      context("cv_other")
    );
    expect(response.status).toBe(404);
  });

  it("responde 404 y no envía si el hilo no pertenece al miembro", async () => {
    const response = await messagesRoute.POST(
      new Request("http://localhost/api/conversations/cv_other/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "intento ajeno" }),
      }),
      context("cv_other")
    );
    expect(response.status).toBe(404);
    expect(state.sendCalls).toBe(0);
  });

  it.each(["suspended", "outside_shift"] as const)(
    "responde 403 y no envía cuando está %s",
    async (reason) => {
      state.sendAllowed = true;
      state.deniedReason = reason;
      const response = await messagesRoute.POST(
        new Request("http://localhost/api/conversations/cv_owned/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: "bloqueado" }),
        }),
        context("cv_owned")
      );
      expect(response.status).toBe(403);
      expect(state.sendCalls).toBe(0);
    }
  );

  it("revalida suspensión dentro del lock y no deja pasar el envío", async () => {
    state.sendAllowed = true;
    state.deniedInsideLock = "suspended";
    const response = await messagesRoute.POST(
      new Request("http://localhost/api/conversations/cv_owned/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "carrera" }),
      }),
      context("cv_owned")
    );
    expect(response.status).toBe(403);
    expect(state.sendCalls).toBe(0);
  });

  it("oculta contacto/notas y lead ajenos antes de leer o mutar", async () => {
    const contactGet = await contactRoute.GET(
      new Request("http://localhost/api/contacts/ct_other"),
      context("ct_other")
    );
    const contactPatch = await contactRoute.PATCH(
      new Request("http://localhost/api/contacts/ct_other", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: "no autorizado" }),
      }),
      context("ct_other")
    );
    const leadPatch = await leadRoute.PATCH(
      new Request("http://localhost/api/pipeline/leads/ld_other", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priority: "alta" }),
      }),
      context("ld_other")
    );
    expect(contactGet.status).toBe(404);
    expect(contactPatch.status).toBe(404);
    expect(leadPatch.status).toBe(404);
    expect(state.contactReads).toBe(0);
  });

  it("responde 404 al pedir un adjunto ajeno por URL directa", async () => {
    const response = await mediaRoute.GET(
      new Request("http://localhost/api/media/ma_other"),
      { params: Promise.resolve({ assetId: "ma_other" }) }
    );
    expect(response.status).toBe(404);
  });

  it("responde 404 y no modifica una cita ligada a un caso ajeno", async () => {
    const response = await bookingRoute.PATCH(
      new Request("http://localhost/api/bookings/bk_other", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      }),
      context("bk_other")
    );
    expect(response.status).toBe(404);
    expect(state.bookingMutations).toBe(0);
  });
});

describe("asignación y tiempo real", () => {
  it("rechaza reasignación de miembros y la permite al propietario", async () => {
    const request = () =>
      new Request("http://localhost/api/conversations/cv_other/assignment", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberId: "mem_a" }),
      });
    const denied = await assignmentRoute.PATCH(request(), context("cv_other"));
    expect(denied.status).toBe(403);
    expect(state.assignmentCalls).toBe(0);

    state.session.role = "owner";
    const allowed = await assignmentRoute.PATCH(request(), context("cv_other"));
    expect(allowed.status).toBe(200);
    expect(state.assignmentCalls).toBe(1);
  });

  it("no entrega eventos de conversaciones ajenas", async () => {
    expect(
      await canReceiveSseEvent(state.session, {
        type: "message.new",
        data: { conversationId: "cv_other", message: {} },
      })
    ).toBe(false);
    expect(
      await canReceiveSseEvent(state.session, {
        type: "message.new",
        data: { conversationId: "cv_owned", message: {} },
      })
    ).toBe(true);
    expect(
      await canReceiveSseEvent(state.session, {
        type: "message.media",
        data: { conversationId: "cv_other", messageId: "msg_1", media: {} },
      })
    ).toBe(false);
    expect(
      await canReceiveSseEvent(state.session, {
        type: "message.media",
        data: { conversationId: "cv_owned", messageId: "msg_1", media: {} },
      })
    ).toBe(true);
    expect(
      await canReceiveSseEvent(state.session, {
        type: "conversation.assignment",
        data: {
          conversationId: "cv_other",
          fromMemberId: "mem_b",
          toMemberId: "mem_c",
          assignmentVersion: 2,
          reason: "manual",
        },
      })
    ).toBe(false);
  });
});

describe("guardas de listados y superficies relacionadas", () => {
  it.each([
    ["src/app/api/contacts/route.ts", "contactScope(session)"],
    ["src/app/api/pipeline/board/route.ts", "leadScope(session)"],
    ["src/app/api/media/[assetId]/route.ts", "canAccessMediaAsset(session"],
    ["src/app/api/events/route.ts", "canReceiveSseEvent(session"],
    ["src/server/agenda/queries.ts", "bookingScope(session)"],
    ["src/app/api/bookings/[id]/route.ts", "canAccessBooking(session"],
  ])("%s conserva la guarda %s", (file, guard) => {
    expect(readFileSync(file, "utf8")).toContain(guard);
  });
});
