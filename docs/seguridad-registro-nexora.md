# Registro y aprovisionamiento seguro de Nexora

## Política de producción

Configura siempre:

```dotenv
REGISTRATION_MODE=closed
```

`closed` bloquea `POST /api/auth/sign-up/email` aunque PostgreSQL esté vacío y
`/register` no presenta el formulario. La app tampoco instala la API de
organizaciones de Better Auth: una cuenta autenticada no puede crear otro
tenant. El alta normal de trabajadoras sigue disponible únicamente en
**Ajustes → Equipo** para una sesión con rol `owner`; el servidor ignora
cualquier organización enviada por el cliente y usa la de la sesión.

`bootstrap` existe para desarrollo o recuperación presencial: permite el
primer registro únicamente mientras no exista ninguna organización. No es el
procedimiento recomendado para un dominio público.

## Migración de Nexora existente

No crees una cuenta inicial en EasyPanel. Mantén `REGISTRATION_MODE=closed`,
restaura PostgreSQL y `/data/media`, conserva `ENCRYPTION_KEY` y
`BETTER_AUTH_SECRET`, y entra con uno de los usuarios migrados. El modo cerrado
no modifica usuarios, hashes, sesiones, organizaciones ni membresías existentes.

## Aprovisionar una instalación realmente vacía

La imagen incluye `/app/provision-owner.mjs`. Este comando no abre HTTP, toma
un advisory lock, exige que no haya usuarios ni organizaciones y crea usuario,
cuenta credential, organización, membresía owner, auditoría, pipeline y perfil
del agente en una sola transacción.

En la consola de `nexora-vocero` de EasyPanel:

```sh
read -r -p "Nombre: " INITIAL_OWNER_NAME
read -r -p "Correo: " INITIAL_OWNER_EMAIL
read -r -s -p "Contraseña (mínimo 12): " INITIAL_OWNER_PASSWORD; echo
export INITIAL_OWNER_NAME INITIAL_OWNER_EMAIL INITIAL_OWNER_PASSWORD
export PROVISION_OWNER_CONFIRM=NEXORA_PROVISION_OWNER
node /app/provision-owner.mjs
unset INITIAL_OWNER_NAME INITIAL_OWNER_EMAIL INITIAL_OWNER_PASSWORD PROVISION_OWNER_CONFIRM
```

Después inicia sesión. No cambies `REGISTRATION_MODE`: debe continuar en
`closed`. Si el comando detecta datos, se cancela sin insertar nada.

## Recuperar al propietario existente

No abras el registro. Genera un hash compatible desde la consola de la app:

```sh
read -r -s -p "Nueva contraseña: " NEW_PASSWORD; echo
export NEW_PASSWORD
node /app/reset-password.mjs propietario@ejemplo.com
unset NEW_PASSWORD
```

El script no conecta ni modifica la base: muestra un `UPDATE` específico para
la cuenta credential. Revisa el correo y pega ese SQL manualmente en la consola
psql de `nexora-db`; debe responder `UPDATE 1`. Registra la operación en la
bitácora administrativa sin guardar la contraseña ni el hash.
