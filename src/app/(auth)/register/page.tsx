import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RegisterForm } from "@/components/auth/register-form";
import { isPublicSignupAllowed } from "@/server/auth/registration";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const allowed = await isPublicSignupAllowed();

  if (!allowed) {
    return (
      <Card className="shadow-md">
        <CardHeader>
          <CardTitle>Registro cerrado</CardTitle>
          <CardDescription>
            Esta instalación no admite cuentas públicas. Solicita acceso al
            propietario de Nexora.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className="text-sm text-primary hover:underline">
            Volver a iniciar sesión
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-md">
      <CardHeader>
        <CardTitle>Crear cuenta</CardTitle>
        <CardDescription>
          El primer registro crea la organización de esta instancia y queda
          como propietario.
        </CardDescription>
      </CardHeader>
      <CardContent><RegisterForm /></CardContent>
    </Card>
  );
}
