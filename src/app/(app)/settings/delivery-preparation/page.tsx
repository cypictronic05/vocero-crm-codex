"use client";

import { useEffect, useState } from "react";

type Preview = { affected: Record<string, number>; preserved: string[]; warning: string };

export default function DeliveryPreparationPage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  async function load() {
    const response = await fetch("/api/settings/delivery-preparation", { cache: "no-store" });
    if (response.ok) setPreview(await response.json());
  }
  useEffect(() => { void load(); }, []);
  async function run(action: "archive" | "restore") {
    if (!window.confirm(action === "archive" ? "¿Confirmas archivar los datos de prueba de esta organización?" : "¿Confirmas restaurar los datos archivados?")) return;
    const response = await fetch("/api/settings/delivery-preparation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, confirm: true }) });
    setMessage(response.ok ? "Operación completada." : "No se pudo completar la operación.");
    await load();
  }
  return <main className="mx-auto max-w-3xl space-y-6 p-6"><div><p className="text-sm text-muted-foreground">Administración · solo propietario</p><h1 className="text-3xl font-semibold">Preparar entrega</h1><p className="mt-2 text-muted-foreground">Vista previa y archivado reversible de datos de prueba. No se elimina información.</p></div>{preview && <section className="rounded-xl border p-5"><h2 className="font-medium">Vista previa</h2><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{Object.entries(preview.affected).map(([key, value]) => <div className="rounded-lg bg-muted p-3" key={key}><div className="text-2xl font-semibold">{value}</div><div className="text-xs text-muted-foreground">{key}</div></div>)}</div><p className="mt-4 text-sm">{preview.warning}</p><h3 className="mt-5 font-medium">Se conserva</h3><ul className="mt-2 list-disc pl-5 text-sm">{preview.preserved.map((item) => <li key={item}>{item}</li>)}</ul></section>}<div className="flex flex-wrap gap-3"><button className="rounded-lg border px-4 py-2" onClick={() => void run("archive")}>Archivar datos de prueba</button><button className="rounded-lg border px-4 py-2" onClick={() => void run("restore")}>Restaurar archivados</button></div>{message && <p role="status">{message}</p>}</main>;
}
