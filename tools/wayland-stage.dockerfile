# Optional guest-only integration stage; append to chromium-display.dockerfile.
# Debian avoids the DHI dev base's signed-library version conflicts for Weston.
FROM chromium AS wayland-integration
RUN --mount=type=secret,id=proxy-ca,required=false,mode=0444 <<'SH'
set -eu
ca=/etc/ssl/certs/ca-certificates.crt
if [ -s /run/secrets/proxy-ca ]; then ca=/run/secrets/proxy-ca; fi
echo "Acquire::https::CAInfo \"$ca\";" > /etc/apt/apt.conf.d/99ca
apt-get update
apt-get install -y --no-install-recommends weston curl
rm -f /etc/apt/apt.conf.d/99ca
mkdir -p /run/display
chown 1000:1000 /run/display
SH
COPY --from=test /opt/sbx-chromium /opt/sbx-chromium
COPY --from=test /tmp/test /tmp/test
USER 1000:1000
ENTRYPOINT ["/opt/sbx-chromium/node/bin/node", "/tmp/test/wayland-test.mjs"]
