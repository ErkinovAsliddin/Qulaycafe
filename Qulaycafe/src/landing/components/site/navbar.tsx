import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Menu, X } from 'lucide-react'
import { Logo } from './logo'
import { cn } from '../../lib/utils'
import { ADMIN_URL, SECTIONS, TELEGRAM_URL } from '../../lib/links'

// Only sections that actually exist get a link. The design export also had
// "Afzalliklar" -> #afzalliklar, which scrolled nowhere.
const NAV_LINKS = [
  { label: 'Imkoniyatlar', href: SECTIONS.features },
  { label: 'Qanday ishlaydi', href: SECTIONS.howItWorks },
  { label: 'Dostavka', href: SECTIONS.delivery },
  { label: 'Narxlar', href: SECTIONS.pricing },
]

const EASE = [0.22, 1, 0.36, 1] as const

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // The mobile sheet covers the page, so the page behind it must not scroll.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // A phone rotated to landscape (or an iPad at 900px) is still below the `lg`
  // breakpoint that reveals the desktop nav, so the sheet has to close itself
  // if the viewport grows past it — otherwise body stays overflow:hidden.
  useEffect(() => {
    if (!open) return
    const mq = window.matchMedia('(min-width: 1024px)')
    const onChange = () => mq.matches && setOpen(false)
    mq.addEventListener('change', onChange)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => {
      mq.removeEventListener('change', onChange)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <motion.header
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
        className="fixed inset-x-0 top-0 z-50"
      >
        <div
          className={cn(
            'mx-auto flex max-w-[1600px] items-center justify-between px-5 transition-all duration-500 md:px-10',
            scrolled ? 'my-2 h-16 md:my-3' : 'h-20 md:h-24',
          )}
        >
          <div
            className={cn(
              'pointer-events-none absolute inset-x-2 top-2 -z-10 h-[calc(100%-1rem)] rounded-2xl border transition-all duration-500 md:inset-x-6',
              scrolled
                ? 'border-border/70 bg-background/80 shadow-[0_8px_40px_-16px_rgba(30,60,45,0.25)] backdrop-blur-xl'
                : 'border-transparent bg-transparent',
            )}
          />
          <a href={SECTIONS.top} aria-label="QulayCafe bosh sahifa">
            {/* The wordmark alone is ~150px; on a 320px phone that plus the two
                buttons overflows, so only the mark shows below `xs`. */}
            <Logo textClassName="hidden text-[1.2rem] min-[380px]:inline sm:text-[1.35rem]" />
          </a>

          <nav className="hidden items-center gap-9 lg:flex">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="group relative text-sm font-medium text-foreground/75 transition-colors hover:text-foreground"
              >
                {link.label}
                <span className="absolute -bottom-1.5 left-0 h-px w-0 bg-primary transition-all duration-300 group-hover:w-full" />
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Existing customers land here — the export had no way into the
                dashboard at all. */}
            <a
              href={ADMIN_URL}
              className="rounded-full px-3 py-2 text-sm font-medium text-foreground/75 transition-colors hover:text-foreground sm:px-4"
            >
              Kirish
            </a>
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="group hidden items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-300 hover:shadow-[0_12px_30px_-10px_rgba(47,125,90,0.7)] sm:inline-flex"
            >
              Bog‘lanish
              <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5" />
            </a>
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Menyuni ochish"
              aria-expanded={open}
              className="grid size-11 place-items-center rounded-xl border border-border/70 bg-background/70 text-foreground backdrop-blur-md transition-colors hover:bg-muted lg:hidden"
            >
              <Menu className="size-5" />
            </button>
          </div>
        </div>
      </motion.header>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            /* `dvh`, not `vh`: on iOS Safari `100vh` is taller than the visible
               area, which pushed the sheet's bottom button off-screen. */
            className="fixed inset-0 z-[60] flex h-[100dvh] flex-col overflow-y-auto bg-background lg:hidden"
          >
            <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-accent/25 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-24 -left-16 size-72 rounded-full bg-primary/15 blur-3xl" />

            <div className="flex h-20 shrink-0 items-center justify-between px-5">
              <Logo />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Menyuni yopish"
                className="grid size-11 place-items-center rounded-xl border border-border/70 bg-background text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <nav className="relative flex flex-1 flex-col justify-center gap-1 px-6 py-4">
              {NAV_LINKS.map((link, i) => (
                <motion.a
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, ease: EASE, delay: 0.12 + i * 0.08 }}
                  /* 4xl/5xl overflowed 320px screens with "Qanday ishlaydi". */
                  className="border-b border-border/60 py-4 font-serif text-3xl font-medium tracking-tight text-foreground min-[400px]:text-4xl sm:py-5 sm:text-5xl"
                >
                  <span className="mr-3 align-middle font-sans text-sm text-primary/70">
                    0{i + 1}
                  </span>
                  {link.label}
                </motion.a>
              ))}
            </nav>

            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: EASE, delay: 0.5 }}
              className="relative shrink-0 space-y-3 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
            >
              <a
                href={TELEGRAM_URL}
                target="_blank"
                rel="noreferrer noopener"
                onClick={() => setOpen(false)}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-lg font-semibold text-primary-foreground shadow-lg"
              >
                Bog‘lanish
                <ArrowRight className="size-5" />
              </a>
              <a
                href={ADMIN_URL}
                onClick={() => setOpen(false)}
                className="flex w-full items-center justify-center rounded-2xl border border-border px-6 py-4 text-lg font-semibold text-foreground"
              >
                Tizimga kirish
              </a>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
