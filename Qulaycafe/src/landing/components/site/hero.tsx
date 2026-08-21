import { motion } from 'motion/react'
import { ArrowRight, Bell, Check, QrCode, Utensils } from 'lucide-react'
import { LineReveal } from './reveal'
import { MagneticButton } from './magnetic-button'
import { Img } from './img'
import { SECTIONS, TELEGRAM_URL } from '../../lib/links'

const EASE = [0.22, 1, 0.36, 1] as const

export function Hero() {
  return (
    <section
      id="top"
      className="relative overflow-hidden pb-16 pt-28 md:pb-24 md:pt-36 lg:pt-40"
    >
      {/* ambient light */}
      <div className="pointer-events-none absolute -right-40 top-10 -z-10 size-[36rem] rounded-full bg-accent/20 blur-[120px]" />
      <div className="pointer-events-none absolute -left-40 top-40 -z-10 size-[30rem] rounded-full bg-secondary/40 blur-[120px]" />

      <div className="mx-auto grid max-w-[1600px] items-center gap-12 px-5 md:px-10 lg:grid-cols-[1.05fr_1fr] lg:gap-8 xl:gap-16">
        {/* LEFT */}
        <div className="relative z-10">
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: EASE, delay: 0.35 }}
            className="mb-6 flex items-center gap-2.5 text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-primary sm:tracking-[0.22em]"
          >
            <span className="h-px w-8 shrink-0 bg-primary/50" />
            QulayCafe — restoranlar uchun platforma
          </motion.p>

          <h1 className="font-serif text-[2.4rem] font-medium leading-[1.04] tracking-tight text-foreground min-[400px]:text-[2.7rem] sm:text-6xl lg:text-[4.1rem] xl:text-[4.6rem]">
            <LineReveal
              lines={['Restoraningizni', 'boshqarish endi']}
              delay={0.5}
            />
            <span className="block overflow-hidden">
              <motion.span
                className="block italic text-primary"
                initial={{ y: '110%' }}
                animate={{ y: '0%' }}
                transition={{ duration: 0.9, ease: EASE, delay: 0.74 }}
              >
                qulay.
              </motion.span>
            </span>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE, delay: 0.9 }}
            className="mt-7 max-w-md text-pretty text-lg leading-relaxed text-muted-foreground"
          >
            QR menyu, buyurtma, oshxona ekrani, stollar, dostavka va
            hisobotlarni bitta tizimda boshqaring.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: EASE, delay: 1.05 }}
            /* Full-width buttons below `sm`: two 180px pills side by side wrap
               into a ragged two-line block on a 360px screen. */
            className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
          >
            <MagneticButton href={TELEGRAM_URL} external>
              Restoranimni ulash
              <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
            </MagneticButton>
            <MagneticButton href={SECTIONS.howItWorks} variant="ghost">
              Qanday ishlaydi?
            </MagneticButton>
          </motion.div>

          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 1, ease: EASE, delay: 1.3 }}
            className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-medium text-foreground/70"
          >
            {['QR menyu', 'Oshxona ekrani', 'Dostavka', 'Hisobotlar'].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span className="grid size-4 place-items-center rounded-full bg-primary/12 text-primary">
                  <Check className="size-2.5" strokeWidth={3} />
                </span>
                {f}
              </li>
            ))}
          </motion.ul>
        </div>

        {/* RIGHT */}
        <div className="relative">
          <motion.div
            initial={{ opacity: 0, scale: 1.06, clipPath: 'inset(8% 8% 8% 8% round 28px)' }}
            animate={{ opacity: 1, scale: 1, clipPath: 'inset(0% 0% 0% 0% round 28px)' }}
            transition={{ duration: 1.2, ease: EASE, delay: 0.3 }}
            className="relative aspect-[4/5] w-full overflow-hidden rounded-[28px] shadow-[0_40px_90px_-40px_rgba(30,50,40,0.5)] sm:aspect-square lg:aspect-[4/4.4]"
          >
            <motion.div
              initial={{ scale: 1.12 }}
              animate={{ scale: 1 }}
              transition={{ duration: 6, ease: 'easeOut' }}
              className="absolute inset-0"
            >
              <Img
                src="/images/restaurant-interior.webp"
                alt="Zamonaviy va yorug' restoran ichki ko'rinishi"
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 45vw"
                className="object-cover"
              />
            </motion.div>
            <div className="absolute inset-0 bg-gradient-to-t from-foreground/25 via-transparent to-transparent" />
          </motion.div>

          {/* floating: order dashboard. Kept inside the image on phones — at
              -left-4 it hung over the screen edge and got clipped. */}
          <motion.div
            initial={{ opacity: 0, y: 40, rotateX: 12, filter: 'blur(6px)' }}
            animate={{ opacity: 1, y: 0, rotateX: 0, filter: 'blur(0px)' }}
            transition={{ duration: 1, ease: EASE, delay: 1.0 }}
            className="absolute -bottom-6 left-2 w-[68%] rounded-2xl border border-border/70 bg-background/90 p-4 shadow-[0_24px_60px_-24px_rgba(30,50,40,0.45)] backdrop-blur-xl min-[400px]:w-[62%] sm:-left-8 sm:w-[54%]"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
                <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary/12 text-primary">
                  <Utensils className="size-3.5" />
                </span>
                Buyurtmalar
              </span>
              <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[0.65rem] font-semibold text-primary">
                Jonli
              </span>
            </div>
            <div className="space-y-2">
              {[
                { t: '12-stol · Burger', s: 'Tayyorlanmoqda' },
                { t: '04-stol · Sezar', s: 'Yangi' },
              ].map((o) => (
                <div
                  key={o.t}
                  className="flex items-center justify-between gap-2 rounded-lg bg-muted/70 px-3 py-2"
                >
                  <span className="truncate text-xs font-medium text-foreground">
                    {o.t}
                  </span>
                  <span className="shrink-0 text-[0.65rem] font-semibold text-primary">
                    {o.s}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* floating: QR chip */}
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.8, ease: EASE, delay: 1.2 }}
            className="absolute right-2 top-6 flex items-center gap-2.5 rounded-2xl border border-border/70 bg-background/90 px-3 py-2.5 shadow-lg backdrop-blur-xl sm:-right-6 sm:top-10 sm:px-4 sm:py-3"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <QrCode className="size-5" />
            </span>
            <div className="leading-tight">
              <p className="text-xs font-semibold text-foreground">QR menyu</p>
              <p className="text-[0.65rem] text-muted-foreground">
                Skanerlang · Buyurtma
              </p>
            </div>
          </motion.div>

          {/* floating: notification toast. Hidden on phones — three overlapping
              cards over one photo left no readable image. */}
          <motion.div
            initial={{ opacity: 0, x: 30, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: 0.7, ease: EASE, delay: 1.5 }}
            className="absolute right-8 top-1/2 hidden items-center gap-2.5 rounded-xl border border-border/70 bg-primary px-4 py-3 text-primary-foreground shadow-xl sm:flex"
          >
            <Bell className="size-4 shrink-0" />
            <p className="text-xs font-semibold">Yangi buyurtma qabul qilindi</p>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
