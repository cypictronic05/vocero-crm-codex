"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Plus, Save, Trash2, UserPlus } from "lucide-react";
import { ContactAvatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  AssignableRole,
  MemberStatus,
  OperatorAvailability,
  WeeklyShift,
} from "@/lib/team";

const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

type Member = {
  id: string;
  role: "owner" | AssignableRole;
  name: string;
  email: string;
  createdAt: string;
  status: MemberStatus;
  weeklySchedule: WeeklyShift[];
  availability: OperatorAvailability;
};

function minuteToTime(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function timeToMinute(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function MemberScheduleCard({ member, canManage, onSaved }: {
  member: Member;
  canManage: boolean;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState(member.status);
  const [role, setRole] = useState<AssignableRole>(
    member.role === "supervisor" ? "supervisor" : "member"
  );
  const [schedule, setSchedule] = useState(member.weeklySchedule);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const editable = canManage && member.role !== "owner";

  useEffect(() => {
    setStatus(member.status);
    if (member.role !== "owner") setRole(member.role);
    setSchedule(member.weeklySchedule);
  }, [member.role, member.status, member.weeklySchedule]);

  function replaceShift(index: number, patch: Partial<WeeklyShift>) {
    setSchedule((current) => current.map((shift, currentIndex) =>
      currentIndex === index ? { ...shift, ...patch } : shift
    ));
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const response = await fetch(`/api/settings/team/${member.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role, status, weeklySchedule: schedule }),
    }).catch(() => null);
    setSaving(false);
    if (!response?.ok) {
      const body = (await response?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setMessage(body?.error?.message ?? "No se pudo guardar");
      return;
    }
    setMessage("Cambios guardados y auditados");
    onSaved();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <ContactAvatar name={member.name} seed={member.id} size="sm" />
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">{member.name}</CardTitle>
            <CardDescription>{member.email}</CardDescription>
          </div>
          <Badge variant={member.role === "owner" ? "default" : "secondary"}>
            {member.role === "owner"
              ? "Propietario"
              : member.role === "supervisor"
                ? "Supervisora"
                : "Miembro"}
          </Badge>
          <Badge variant={member.availability.canSend ? "default" : "outline"}>
            {member.availability.canSend
              ? "Disponible"
              : member.availability.reason === "suspended" ? "Suspendido" : "Fuera de turno"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {member.role === "owner" ? (
          <p className="rounded-md border bg-subtle px-3 py-2 text-sm text-text-2">
            El propietario conserva siempre acceso de administración y envío para recuperar la instancia.
          </p>
        ) : (
          <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`role-${member.id}`}>Rol</Label>
              <select
                id={`role-${member.id}`}
                value={role}
                disabled={!editable}
                onChange={(event) => setRole(event.target.value as AssignableRole)}
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm disabled:opacity-60"
              >
                <option value="member">Operadora</option>
                <option value="supervisor">Supervisora</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`status-${member.id}`}>Estado administrativo</Label>
              <select
                id={`status-${member.id}`}
                value={status}
                disabled={!editable}
                onChange={(event) => setStatus(event.target.value as MemberStatus)}
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm disabled:opacity-60"
              >
                <option value="enabled">Habilitado</option>
                <option value="suspended">Suspendido</option>
              </select>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <CalendarClock className="h-4 w-4" />
            Horario semanal · America/Bogota
          </div>
          <div className="space-y-2">
            {DAYS.map((dayLabel, day) => {
              const shifts = schedule.map((shift, index) => ({ shift, index })).filter(({ shift }) => shift.day === day);
              return (
                <div key={dayLabel} className="grid gap-2 rounded-md border bg-subtle p-2.5 md:grid-cols-[110px_1fr]">
                  <p className="pt-2 text-sm font-medium">{dayLabel}</p>
                  <div className="space-y-2">
                    {shifts.length === 0 && <p className="py-2 text-xs text-text-3">Sin turno</p>}
                    {shifts.map(({ shift, index }) => (
                      <div key={`${day}-${index}`} className="flex flex-wrap items-center gap-2">
                        <Input
                          type="time"
                          aria-label={`Inicio ${dayLabel}`}
                          value={minuteToTime(shift.startMinute)}
                          disabled={!editable}
                          onChange={(event) => replaceShift(index, { startMinute: timeToMinute(event.target.value) })}
                          className="w-32"
                        />
                        <span className="text-xs text-text-3">a</span>
                        <Input
                          type="time"
                          aria-label={`Fin ${dayLabel}`}
                          value={minuteToTime(shift.endMinute)}
                          disabled={!editable}
                          onChange={(event) => replaceShift(index, { endMinute: timeToMinute(event.target.value) })}
                          className="w-32"
                        />
                        {editable && (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`Quitar turno de ${dayLabel}`}
                            onClick={() => setSchedule((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                        {shift.startMinute > shift.endMinute && <span className="text-xs text-text-3">cruza medianoche</span>}
                      </div>
                    ))}
                    {editable && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setSchedule((current) => [...current, { day, startMinute: 6 * 60, endMinute: 22 * 60 }])}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Añadir turno
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {editable && (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void save()} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? "Guardando…" : "Guardar configuración"}
            </Button>
            {message && <p className="text-sm text-text-2">{message}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TeamClient() {
  const [members, setMembers] = useState<Member[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [newRole, setNewRole] = useState<AssignableRole>("member");
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/team", { cache: "no-store" }).catch(() => null);
    if (!res?.ok) return;
    const data = (await res.json()) as { members: Member[]; canManage: boolean };
    setMembers(data.members);
    setCanManage(data.canManage);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  function generatePassword() {
    const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint32Array(14);
    crypto.getRandomValues(bytes);
    setTempPassword(Array.from(bytes, (b) => alphabet[b % alphabet.length]).join(""));
  }

  async function create() {
    setSaving(true);
    setError(null);
    setCreated(null);
    const res = await fetch("/api/settings/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        password: tempPassword,
        role: newRole,
      }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(data?.error?.message ?? "No se pudo crear la cuenta");
      return;
    }
    setCreated({ email, password: tempPassword });
    setName("");
    setEmail("");
    setTempPassword("");
    setNewRole("member");
    void refetch();
  }

  return (
    <div className="max-w-4xl space-y-6">
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Crear cuenta de equipo</CardTitle>
            <CardDescription>
              La cuenta queda habilitada de 06:00 a 22:00, todos los días, en America/Bogota.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="team-name">Nombre</Label>
                <Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="team-email">Correo</Label>
                <Input id="team-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="team-password">Contraseña temporal</Label>
              <div className="flex gap-2">
                <Input id="team-password" value={tempPassword} onChange={(e) => setTempPassword(e.target.value)} placeholder="mínimo 8 caracteres" />
                <Button variant="outline" onClick={generatePassword}>Generar</Button>
              </div>
            </div>
            <div className="max-w-xs space-y-1.5">
              <Label htmlFor="team-role">Rol inicial</Label>
              <select
                id="team-role"
                value={newRole}
                onChange={(event) =>
                  setNewRole(event.target.value as AssignableRole)
                }
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="member">Operadora</option>
                <option value="supervisor">Supervisora</option>
              </select>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {created && (
              <div className="rounded-md border border-success-soft bg-success-tint p-3 text-sm text-success-text">
                Cuenta creada. Comparte ahora <code>{created.email}</code> · contraseña <code>{created.password}</code>.
              </div>
            )}
            <Button disabled={saving || !name.trim() || !email.trim() || tempPassword.length < 8} onClick={() => void create()}>
              <UserPlus className="h-4 w-4" />
              {saving ? "Creando…" : "Crear cuenta"}
            </Button>
          </CardContent>
        </Card>
      )}

      {!canManage && (
        <p className="rounded-md border bg-subtle px-4 py-3 text-sm text-text-2">
          Solo el propietario puede modificar estados y horarios. Aquí puedes consultar la configuración actual.
        </p>
      )}

      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Miembros y turnos</p>
        {members.map((member) => (
          <MemberScheduleCard key={member.id} member={member} canManage={canManage} onSaved={() => void refetch()} />
        ))}
      </div>
    </div>
  );
}
