import { useRef, useState } from 'react'
import {
  motion,
  useScroll,
  useTransform,
  useMotionValueEvent,
} from 'motion/react'
import { QrCode, ClipboardList, Flame, Bike, BarChart3 } from 'lucide-react'
import { Reveal } from './reveal'

const STEPS = [
  {
    icon: QrCode,
    title: 'QR menyu',
    desc: 'Mehmon stolidagi QR kodni skanerlaydi va menyuni o‘z tilida ochadi.',
  },
  {
    icon: ClipboardList,
    title: 'Buyurtma',
    desc: 'Stolga, dostavkaga yoki olib ketishga — buyurtma bir necha soniyada tizimga tushadi.',
  },
  {
    icon: Flame,
    title: 'Oshxona',
    desc: 'Buyurtma darhol oshxona ekranida ko‘rinadi: turi va tarkibi aniq belgilangan.',
  },
  {
    icon: Bike,
    title: 'Yetkazish',
    desc: 'Dostavka bo‘lsa — kuryer Telegram botda xarita pinini oladi. Zalda bo‘lsa — ofitsiant stolga yetkazadi.',
  },
  {
    icon: BarChart3,
    title: 'Hisobot',
    desc: 'Har bir buyurtma tushum, mashhur taomlar va to‘lov hisobotiga qo‘shiladi.',
  },
]

const EASE = [0.22, 1, 0.36, 1] as const

export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 65%', 'end 65%'],
  })
  const lineScale = useTransform(scrollYProgress, [0, 1], [0, 1])

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const idx = Math.min(STEPS.length - 1, Math.floor(v * STEPS.length))
    setActive(idx)
  })

  return (
    // No scroll-mt here: styles.css sets scroll-padding-top on <html>, which
    // clears the fixed header for every anchor on the page. Both together
    // stacked into ~11rem of dead space above the heading.
    <section id="qanday-ishlaydi" className="relative bg-card py-20 md:py-36">
      <div className="mx-auto max-w-[1600px] px-5 md:px-10">
        <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          {/* sticky heading */}
          <div className="lg:sticky lg:top-32 lg:h-fit">
            <Reveal>
              <p className="mb-6 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                02 — Qanday ishlaydi
              </p>
              <h2 className="text-balance font-serif text-3xl font-medium leading-[1.08] tracking-tight text-foreground min-[400px]:text-4xl sm:text-5xl lg:text-6xl">
                Hammasi bir tizimda.
              </h2>
              <p className="mt-6 max-w-sm text-pretty text-lg leading-relaxed text-muted-foreground">
                Buyurtma butun tizim bo‘ylab uzluksiz harakatlanadi — mehmondan
                hisobotgacha.
              </p>

              <div className="mt-10 hidden items-center gap-3 lg:flex">
                {STEPS.map((s, i) => (
                  <span
                    key={s.title}
                    className={`h-1.5 rounded-full transition-all duration-500 ${
                      i <= active ? 'w-10 bg-primary' : 'w-4 bg-border'
                    }`}
                  />
                ))}
              </div>
            </Reveal>
          </div>

          {/* timeline. The icon column is narrower on phones (44px badge at
              pl-12) so the card keeps a readable line length at 360px. */}
          <div ref={ref} className="relative pl-12 sm:pl-14 md:pl-16">
            {/* track */}
            <div className="absolute left-[21px] top-3 h-[calc(100%-1.5rem)] w-px bg-border sm:left-[26px] md:left-7" />
            <motion.div
              style={{ scaleY: lineScale }}
              className="absolute left-[21px] top-3 h-[calc(100%-1.5rem)] w-px origin-top bg-primary sm:left-[26px] md:left-7"
            />

            <div className="flex flex-col gap-8 sm:gap-10 md:gap-14">
              {STEPS.map((step, i) => {
                const Icon = step.icon
                const isActive = i <= active
                return (
                  <motion.div
                    key={step.title}
                    initial={{ opacity: 0, x: 24 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, amount: 0.5 }}
                    transition={{ duration: 0.7, ease: EASE }}
                    className="relative"
                  >
                    <span
                      className={`absolute -left-12 top-0 grid size-[44px] place-items-center rounded-2xl border transition-all duration-500 sm:-left-14 sm:size-[54px] md:-left-16 ${
                        isActive
                          ? 'border-primary bg-primary text-primary-foreground shadow-[0_12px_30px_-12px_rgba(47,125,90,0.7)]'
                          : 'border-border bg-card text-muted-foreground'
                      }`}
                    >
                      <Icon className="size-5 sm:size-6" />
                    </span>
                    <div
                      className={`rounded-2xl border p-5 transition-all duration-500 sm:p-6 md:p-7 ${
                        isActive
                          ? 'border-primary/25 bg-background shadow-[0_20px_50px_-30px_rgba(30,50,40,0.4)]'
                          : 'border-border/70 bg-background/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-semibold text-primary">
                          0{i + 1}
                        </span>
                        <h3 className="font-serif text-xl font-medium tracking-tight text-foreground sm:text-2xl">
                          {step.title}
                        </h3>
                      </div>
                      <p className="mt-2 text-pretty leading-relaxed text-muted-foreground">
                        {step.desc}
                      </p>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
