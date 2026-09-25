# Print from phones through an Alibaba-hosted app

The admin browser sends the print request to the app backend. With this
deployment, the backend runs in Docker on Alibaba Cloud, so the cafe router
must provide a WireGuard **server** connection that gives that backend a route
to the printer. A router that only has a VPN client feature is not sufficient.

## Cafe router

1. Reserve a fixed DHCP address for the XP-80U and confirm its raw TCP print
   port (usually `9100`).
2. Enable the router's WireGuard server and its option to let the peer access
   devices on the cafe LAN.
3. Create/export one WireGuard client profile for the Alibaba app. The router
   must be reachable at its VPN endpoint. If the cafe connection is behind
   carrier-grade NAT, an inbound router VPN may not be reachable; use a
   Tailscale-capable subnet router or another outbound-tunnel design instead.

## Alibaba Docker host

1. Copy the router's client profile to `wireguard/wg_confs/wg0.conf` next to
   `docker-compose.wireguard.yml`. Keep it private; it contains a private key
   and is excluded from Git.
2. In the client profile's `[Peer]`, set `AllowedIPs` to only the reserved
   printer IP with `/32`, for example `AllowedIPs = 192.168.1.50/32`. Replace
   the example with the printer's actual IP. Do not route `0.0.0.0/0` or the
   entire cafe subnet. The router must permit LAN access and route replies for
   this VPN peer.
3. Allow outbound UDP from the Alibaba host to the router's WireGuard endpoint
   in its cloud security group if outbound traffic is restricted.
4. From this project directory, stop the existing app stack without deleting
   its data volume, then start this deployment profile:

   ```sh
   docker compose down
   docker compose -f docker-compose.wireguard.yml up -d --build
   ```

   Do not add `-v` to `docker compose down`; that would remove the persistent
   database volume. The VPN profile maps the existing app data volume and
   publishes the app on port `6000` through the WireGuard container's network.

## Verify printing

After the WireGuard container connects, open Admin → Branding → Thermal
Printer, select **LAN / Wi-Fi**, enter the reserved printer IP and port `9100`,
and save. Press **Ulanishni tekshirish**. This checks TCP reachability from the
same app container that will send receipts, without printing a test slip. When
it reports a successful connection, press **Termal** from the admin page on a
phone to print an order.

Never expose printer port `9100` to the public internet. If the container
starts but the connection check fails, inspect the router's peer/LAN access
rules, the Alibaba UDP egress rule, and the private printer IP/port. No VPN
credentials or private keys should be committed or sent in chat.
