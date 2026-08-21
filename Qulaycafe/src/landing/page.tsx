import { MotionConfig } from 'motion/react'
import { Navbar } from './components/site/navbar'
import { Hero } from './components/site/hero'
import { Problem } from './components/site/problem'
import { HowItWorks } from './components/site/how-it-works'
import { QrMenu } from './components/site/qr-menu'
import { KitchenDisplay } from './components/site/kitchen-display'
import { Tables } from './components/site/tables'
import { Gallery } from './components/site/gallery'
import { Analytics } from './components/site/analytics'
import { Ecosystem } from './components/site/ecosystem'
import { Delivery } from './components/site/delivery'
import { Surfaces } from './components/site/surfaces'
import { Pricing } from './components/site/pricing'
import { CTA } from './components/site/cta'
import { Footer } from './components/site/footer'

export default function Page() {
  return (
    // reducedMotion="user" makes every motion component here honour
    // prefers-reduced-motion without each one having to check it.
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen bg-background">
        <Navbar />
        {/* No id here: the hero section already carries id="top", which is
            where the logo link scrolls to. */}
        <main>
          <Hero />
          <Problem />
          <HowItWorks />
          <QrMenu />
          <KitchenDisplay />
          <Tables />
          <Gallery />
          <Analytics />
          <Ecosystem />
          <Delivery />
          <Surfaces />
          <Pricing />
          <CTA />
        </main>
        <Footer />
      </div>
    </MotionConfig>
  )
}
