import { motion } from 'motion/react'
import { Reveal } from './reveal'
import { Img } from './img'

const MOMENTS = [
  'Mehmon',
  'QR menyu',
  'Buyurtma',
  'Oshxona',
  'Ofitsiant',
  'Dostavka',
  'Hisobot',
]

const EASE = [0.22, 1, 0.36, 1] as const

export function Problem() {
  return (
    <section className="relative overflow-hidden py-20 md:py-36">
      <div className="mx-auto max-w-[1600px] px-5 md:px-10">
        <div className="grid items-end gap-10 lg:grid-cols-[1.2fr_1fr]">
          <Reveal>
            <p className="mb-6 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
              01 — Muammo
            </p>
            <h2 className="max-w-2xl text-balance font-serif text-3xl font-medium leading-[1.08] tracking-tight text-foreground min-[400px]:text-4xl sm:text-5xl lg:text-6xl">
              Restorandagi har bir jarayon muhim.
            </h2>
          </Reveal>
          <Reveal delay={0.15}>
            <p className="max-w-md text-pretty text-lg leading-relaxed text-muted-foreground">
              Buyurtma qabul qilishdan tortib to‘lovgacha — kichik uzilish ham
              mehmon tajribasiga ta’sir qiladi. Ko‘p tizimlar bir-biridan
              ajralgan holda ishlaydi.
            </p>
          </Reveal>
        </div>

        {/* connected moments */}
        <div className="relative mt-12 md:mt-20">
          <div className="relative flex flex-wrap items-center gap-x-2 gap-y-3 sm:gap-x-3 sm:gap-y-4">
            {MOMENTS.map((m, i) => (
              <motion.div
                key={m}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.6 }}
                transition={{ duration: 0.6, ease: EASE, delay: i * 0.08 }}
                className="flex items-center gap-3"
              >
                <span className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm sm:px-5 sm:py-2.5">
                  {m}
                </span>
                {i < MOMENTS.length - 1 && (
                  <motion.span
                    initial={{ scaleX: 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true, amount: 0.6 }}
                    transition={{
                      duration: 0.4,
                      ease: EASE,
                      delay: i * 0.08 + 0.2,
                    }}
                    className="hidden h-px w-6 origin-left bg-border sm:block"
                  />
                )}
              </motion.div>
            ))}
          </div>
        </div>

        {/* unify statement + imagery */}
        <div className="mt-14 grid items-center gap-8 md:mt-24 lg:grid-cols-2">
          <Reveal className="order-2 lg:order-1">
            <h3 className="text-balance font-serif text-2xl font-medium leading-[1.12] tracking-tight text-foreground min-[400px]:text-3xl sm:text-4xl lg:text-5xl">
              QulayCafe barchasini{' '}
              <span className="italic text-primary">birlashtiradi.</span>
            </h3>
            <p className="mt-5 max-w-md text-pretty text-lg leading-relaxed text-muted-foreground">
              Mehmon, ofitsiant, oshxona va kuryer bitta uzluksiz oqimda. Har
              bir buyurtma — boshidan oxirigacha nazorat ostida.
            </p>
          </Reveal>

          <div className="order-1 grid grid-cols-2 gap-3 sm:gap-4 lg:order-2">
            {[
              { src: '/images/dining.webp', alt: 'Restoranda ovqatlanayotgan mehmonlar', tall: true },
              { src: '/images/chef.webp', alt: 'Taom tayyorlayotgan oshpaz', tall: false },
              { src: '/images/coffee.webp', alt: 'Latte art bilan qahva', tall: false },
              { src: '/images/dish-salad.webp', alt: 'Yangi salat', tall: true },
            ].map((img, i) => (
              <motion.div
                key={img.src}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                transition={{ duration: 0.8, ease: EASE, delay: i * 0.1 }}
                className={`relative overflow-hidden rounded-2xl ${
                  img.tall ? 'row-span-2 aspect-[3/4]' : 'aspect-[4/3]'
                } ${i === 1 ? 'mt-4 sm:mt-8' : ''}`}
              >
                <Img
                  src={img.src}
                  alt={img.alt}
                  fill
                  sizes="(max-width: 1024px) 45vw, 25vw"
                  className="object-cover transition-transform duration-700 hover:scale-105"
                />
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
