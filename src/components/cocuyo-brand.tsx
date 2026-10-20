import { cn } from "@/lib/utils";
import { PRODUCT_FAVICON } from "@/lib/product-brand";

/**
 * Símbolo estático del producto. No depende de la marca de la organización:
 * Nexora conserva su nombre, color e icono en las superficies que identifican
 * al negocio, mientras este distintivo identifica el CRM que lo contiene.
 */
export function CocuyoMark({ className }: { className?: string }) {
  return (
    // El mismo SVG estático sirve al login, la navegación y el favicon: así
    // no pueden separarse visualmente después de un ajuste de marca.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={PRODUCT_FAVICON}
      alt=""
      className={cn("shrink-0 object-contain", className)}
      aria-hidden="true"
    />
  );
}
export function CocuyoLogo({
  className,
  compact = false,
  inverted = false,
}: {
  className?: string;
  compact?: boolean;
  inverted?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center",
        compact ? "gap-2.5" : "flex-col gap-2 text-center",
        className,
      )}
    >
      <CocuyoMark
        className={cn(
          compact
            ? "h-10 w-12"
            : "h-[104px] w-[120px] sm:h-[132px] sm:w-[152px] sm:origin-bottom sm:scale-150",
          compact && inverted && "rounded-[10px] bg-white/95 p-1",
        )}
      />
      <span
        className={cn(
          "whitespace-nowrap font-extrabold leading-none tracking-[-0.045em]",
          compact ? "text-[17px]" : "text-[30px] sm:text-[60px]",
          inverted ? "text-white" : "text-[#101d3c]",
        )}
      >
        CRM - <span className={inverted ? "text-[#69a7ff]" : "text-[#1265d8]"}>COCUYO</span>
      </span>
    </div>
  );
}
