import { useRef, type ReactNode } from 'react'
import { motion, useMotionValue, useSpring } from 'motion/react'
import { cn } from '../../lib/utils'

/**
 * Pill link that leans toward the cursor. `onMouseMove` never fires on a
 * touchscreen, so on phones this is simply a static button — no fallback
 * needed, but also no hover-only affordance may carry meaning.
 */
export function MagneticButton({
  children,
  href,
  variant = 'primary',
  external = false,
  className,
}: {
  children: ReactNode
  href: string
  variant?: 'primary' | 'ghost'
  /** Opens in a new tab with `rel="noreferrer"` — for t.me / tel: targets. */
  external?: boolean
  className?: string
}) {
  const ref = useRef<HTMLAnchorElement>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 260, damping: 18, mass: 0.4 })
  const sy = useSpring(y, { stiffness: 260, damping: 18, mass: 0.4 })

  function onMove(e: React.MouseEvent<HTMLAnchorElement>) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const relX = e.clientX - (rect.left + rect.width / 2)
    const relY = e.clientY - (rect.top + rect.height / 2)
    x.set(relX * 0.25)
    y.set(relY * 0.35)
  }

  function reset() {
    x.set(0)
    y.set(0)
  }

  return (
    <motion.a
      ref={ref}
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer noopener' : undefined}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={{ x: sx, y: sy }}
      className={cn(
        'group inline-flex items-center justify-center gap-2 rounded-full px-7 py-4 text-center text-base font-semibold transition-colors duration-300',
        variant === 'primary'
          ? 'bg-primary text-primary-foreground shadow-[0_16px_40px_-14px_rgba(47,125,90,0.6)] hover:bg-primary/90'
          : 'border border-border bg-background/60 text-foreground backdrop-blur hover:bg-muted',
        className,
      )}
    >
      {children}
    </motion.a>
  )
}
