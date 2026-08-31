#!/bin/bash
# Resets a USB device by unbinding then rebinding it at the driver level —
# the software equivalent of physically unplugging and replugging it,
# without needing physical access. See server/services/rs485.js's
# resetUsbAdapter() for the real production incident that motivated this
# (a USB-to-RS485 adapter that wedged itself; only a real unplug/replug,
# or this, fixed it — nothing on the remote node side could).
#
# This is the ONE thing this whole script is trusted to do, and it's meant
# to be invoked via a narrowly scoped sudoers rule (see the setup
# instructions in rs485.js's chat history / your deployment notes) — the
# Node server itself does NOT run as root; only this one script, only for
# this one action, does.
#
# Usage: rs485-usb-reset.sh <usb-bus-id>   (e.g. "1-1.2" — see
#   findUsbBusId() in rs485.js for how that id gets determined)

set -euo pipefail

BUS_ID="${1:?Usage: $0 <usb-bus-id>}"

# Guard against being pointed at something that isn't a real bus-id shape
# (defense in depth — the sudoers rule already limits this script to root,
# but a stray/garbled argument should still fail loudly, not silently
# unbind/rebind an unintended device).
if [[ ! "$BUS_ID" =~ ^[0-9]+(-[0-9]+)+$ ]]; then
  echo "Refusing to act on implausible bus id: $BUS_ID" >&2
  exit 1
fi

echo "$BUS_ID" > /sys/bus/usb/drivers/usb/unbind
sleep 0.5
echo "$BUS_ID" > /sys/bus/usb/drivers/usb/bind
