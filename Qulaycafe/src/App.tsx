import React, { Suspense } from 'react';
import CustomerApp from './apps/CustomerApp';
import { getSurface, isStaffSurface } from './utils/surface';

// ---------------------------------------------------------------------------
// Surface router.
//
// Which app a browser gets is decided by the hostname it asked for, once, here:
//
//   clients.qulaycafe.uz  → the guest menu (CustomerApp)
//   kitchen.qulaycafe.uz  → the kitchen screen (StaffApp)
//   admin.qulaycafe.uz    → the dashboard (StaffApp)
//   qulaycafe.uz          → the static landing page, served by the server; a
//                           browser that reaches React on the apex is treated
//                           as a guest, never as staff
//
// The staff tree is behind React.lazy, so a guest browser never even requests
// the chunk that contains the dashboard and the kitchen display: the isolation
// is at the network level, not just a hidden button. There is no in-app view
// switch anywhere — the old ?view=admin / ?view=kitchen escape hatches are
// gone, and the guest header has no staff entry points left.
// ---------------------------------------------------------------------------
const StaffApp = React.lazy(() => import('./apps/StaffApp'));

export default function App() {
  const surface = getSurface();

  if (isStaffSurface(surface)) {
    return (
      <Suspense
        fallback={
          <div className="min-h-screen bg-zinc-100 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-zinc-300 border-t-orange-500 rounded-full animate-spin" />
          </div>
        }
      >
        <StaffApp surface={surface as 'admin' | 'kitchen'} />
      </Suspense>
    );
  }

  return <CustomerApp />;
}
