import { CocuyoLogo } from "@/components/cocuyo-brand";
import { COCUYOTEC_URL } from "@/lib/product-brand";

/**
 * Acceso con identidad fija del producto. La marca organizacional (Nexora)
 * continúa dentro del CRM y no altera esta portada pública.
 */
export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="auth-cocuyo relative grid min-h-[100svh] grid-rows-[1fr_auto] overflow-hidden bg-[#f7f9fc] px-4 py-6 text-[#101d3c] sm:px-6 sm:py-8">
      <div className="auth-cocuyo-grid absolute inset-0" aria-hidden />
      <div className="relative flex items-center justify-center py-6 sm:py-10">
        <div className="w-full max-w-[800px]">
          <div className="mb-7 flex justify-center sm:mb-6">
            <h1 className="sr-only">CRM - COCUYO</h1>
            <CocuyoLogo />
          </div>
          {children}
        </div>
      </div>
      <footer className="relative px-2 pt-4 text-center text-[12px] leading-5 text-[#64718a] sm:text-[13px]">
        Personalizado por{" "}
        <a
          href={COCUYOTEC_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="font-semibold text-[#344766] underline-offset-4 hover:text-[#1265d8] hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1265d8]"
        >
          Cocuyotec SPA
        </a>
      </footer>
    </main>
  );
}
