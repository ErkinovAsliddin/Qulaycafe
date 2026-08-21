import { Reveal } from './reveal'
import { Img } from './img'

const shots = [
  { src: '/images/dish-main.webp', alt: "Yakuniy ko'rinishda tayyorlangan asosiy taom", span: 'row-span-2' },
  { src: '/images/coffee.webp', alt: 'Latte art bilan cappuccino' },
  { src: '/images/food-closeup.webp', alt: 'Yangi tayyorlangan burger yaqindan' },
  { src: '/images/chef.webp', alt: 'Oshpaz taomni bezayapti', span: 'row-span-2' },
  { src: '/images/dish-salad.webp', alt: 'Yangi yashil salat' },
  { src: '/images/dining.webp', alt: "Do'stlar restoranda ovqatlanmoqda" },
]

export function Gallery() {
  return (
    <section className="relative overflow-hidden py-20 sm:py-32">
      <div className="mx-auto max-w-[1600px] px-5 md:px-10">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Mehmon tajribasi
              </span>
              <h2 className="mt-6 text-balance font-serif text-3xl font-medium leading-tight tracking-tight min-[400px]:text-4xl sm:text-5xl">
                Texnologiya ko&apos;rinmaydi. Faqat mukammal xizmat seziladi.
              </h2>
            </div>
            <p className="max-w-xs text-pretty leading-relaxed text-muted-foreground">
              QulayCafe fon rejasida ishlaydi — mehmonlaringiz esa faqat tez,
              iliq va xatosiz xizmatni his qiladi.
            </p>
          </div>
        </Reveal>

        {/* auto-rows are shorter on phones: at 200px a row-span-2 tile was
            400px tall next to two 200px tiles, which pushed the grid well past
            a phone screen. */}
        <div className="mt-12 grid auto-rows-[130px] grid-cols-2 gap-3 min-[400px]:auto-rows-[160px] sm:auto-rows-[240px] sm:gap-4 lg:grid-cols-4">
          {shots.map((shot, i) => (
            <Reveal
              key={shot.src}
              delay={i * 0.06}
              className={`group relative overflow-hidden rounded-2xl ${shot.span ?? ''}`}
            >
              <div className="relative h-full w-full">
                <Img
                  src={shot.src}
                  alt={shot.alt}
                  fill
                  sizes="(max-width: 1024px) 50vw, 25vw"
                  className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-foreground/25 via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
