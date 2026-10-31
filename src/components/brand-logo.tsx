import { cn } from "@/components/ui";

type BrandLogoProps = {
  className?: string;
  size?: number;
  priority?: boolean;
};

/**
 * Neon coral clapperboard mark.
 * Uses a plain <img> so Electron and static hosting never break on next/image.
 */
export function BrandLogo({ className, size = 32 }: BrandLogoProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/brand/shortlio-icon.png"
      alt="Shortlio"
      width={size}
      height={size}
      className={cn("rounded-[9px] object-cover", className)}
      draggable={false}
    />
  );
}
