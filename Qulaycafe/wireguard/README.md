# Alibaba-to-cafe printer VPN

This folder is mounted into the optional WireGuard sidecar in
`docker-compose.wireguard.yml`. Keep the router-generated client profile in
`wg_confs/wg0.conf`. Profiles in that directory are ignored by Git because
they contain private keys.

The client profile must route only the printer's reserved LAN address, for
example `AllowedIPs = 192.168.1.50/32`. Replace that example with the actual
printer IP. In the router's VPN settings, allow this peer to access the LAN
printer and make sure the router can forward/return that traffic. Do not route
all internet traffic through the cafe VPN and do not expose printer TCP port
9100 to the public internet.

The app container and WireGuard sidecar share one network namespace. The
sidecar publishes port 6000 for the web app; do not run the existing Compose
stack at the same time because it also publishes that port and uses the same
database volume.
