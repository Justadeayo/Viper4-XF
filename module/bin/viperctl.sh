#!/system/bin/sh
# ViPER4Android-RE control script.
#
# Called by the KernelSU WebUI (runs as root). It keeps the saved state in
# /data/adb/viper_re and publishes a copy to the path the DSP driver watches.
#
# Usage:
#   viperctl.sh status
#   viperctl.sh get
#   viperctl.sh set <param> <b|i|f> <value>
#   viperctl.sh setmany "<param> <b|i|f> <value>;..."
#   viperctl.sh clear
#   viperctl.sh preset list
#   viperctl.sh preset save <name>
#   viperctl.sh preset load <name>
#   viperctl.sh preset delete <name>

STATE_DIR=/data/adb/viper_re
CURRENT="$STATE_DIR/current.conf"
PRESET_DIR="$STATE_DIR/presets"
LIVE_DIR=/data/local/tmp/viper_re
LIVE="$LIVE_DIR/params.conf"

die() {
  echo "error: $1" >&2
  exit 1
}

ensure_dirs() {
  mkdir -p "$PRESET_DIR" "$LIVE_DIR" || die "cannot create $STATE_DIR"
  [ -f "$CURRENT" ] || : > "$CURRENT"
}

# Copy the saved state to the live path. mv is atomic, so the driver never
# reads a half-written file.
publish() {
  cp -f "$CURRENT" "$LIVE.tmp" || die "cannot write live config"
  chmod 0644 "$LIVE.tmp"
  mv -f "$LIVE.tmp" "$LIVE" || die "cannot publish live config"
}

valid_name() {
  echo "$1" | grep -Eqx '[A-Za-z0-9_-]{1,32}'
}

cmd_status() {
  ensure_dirs
  if grep -qs 'v4a_re' /vendor/etc/audio_effects*.xml /system/etc/audio_effects*.xml \
      /vendor/etc/audio_effects*.conf /system/etc/audio_effects*.conf; then
    echo "patched=yes"
  else
    echo "patched=no"
  fi
  if [ -f "$LIVE" ]; then echo "live=yes"; else echo "live=no"; fi
  echo "params=$(grep -c . "$CURRENT")"
  last=$(logcat -d -s 'ViPER4Android:*' 2>/dev/null | tail -n 1)
  echo "log=${last:-none}"
}

cmd_get() {
  ensure_dirs
  cat "$CURRENT"
}

# Checks one "<param> <type> <value>" entry. Exits with an error if it is bad.
validate_entry() {
  param=$1
  type=$2
  value=$3

  echo "$param" | grep -Eqx '0x[0-9A-Fa-f]{1,8}|[0-9]{1,10}' || die "bad param: $param"
  case "$type" in
    b|i|f) ;;
    *) die "bad type: $type" ;;
  esac
  echo "$value" | grep -Eqx -- '-?[0-9]{1,9}(\.[0-9]{1,6})?' || die "bad value: $value"
  if [ "$type" = b ] && [ "$value" != 0 ] && [ "$value" != 1 ]; then
    die "bool value must be 0 or 1"
  fi
  if [ "$type" = i ] && echo "$value" | grep -q '\.'; then
    die "int value must not have a decimal point"
  fi
}

# Replaces the saved line for one parameter. Does not publish.
write_entry() {
  grep -v "^$1 " "$CURRENT" > "$CURRENT.tmp"
  echo "$1 $2 $3" >> "$CURRENT.tmp"
  mv -f "$CURRENT.tmp" "$CURRENT"
}

cmd_set() {
  validate_entry "$1" "$2" "$3"
  ensure_dirs
  write_entry "$1" "$2" "$3"
  publish
}

# setmany "<param> <type> <value>;<param> <type> <value>;..."
# Validates every entry before writing any, then publishes once.
cmd_setmany() {
  blob=$1
  ensure_dirs

  entries="$PRESET_DIR/.setmany.tmp"
  echo "$blob" | tr ';' '\n' | grep -v '^[[:space:]]*$' > "$entries" || die "empty update"

  while read -r p t v; do
    validate_entry "$p" "$t" "$v"
  done < "$entries"

  while read -r p t v; do
    write_entry "$p" "$t" "$v"
  done < "$entries"
  rm -f "$entries"
  publish
}

cmd_clear() {
  ensure_dirs
  : > "$CURRENT"
  publish
}

cmd_preset() {
  action=$1
  name=$2
  ensure_dirs

  case "$action" in
    list)
      for f in "$PRESET_DIR"/*.conf; do
        [ -f "$f" ] && basename "$f" .conf
      done
      return 0
      ;;
  esac

  valid_name "$name" || die "bad preset name: $name"
  case "$action" in
    save)
      cp -f "$CURRENT" "$PRESET_DIR/$name.conf" || die "cannot save preset"
      ;;
    load)
      [ -f "$PRESET_DIR/$name.conf" ] || die "no such preset: $name"
      cp -f "$PRESET_DIR/$name.conf" "$CURRENT" || die "cannot load preset"
      publish
      ;;
    delete)
      rm -f "$PRESET_DIR/$name.conf"
      ;;
    *)
      die "unknown preset action: $action"
      ;;
  esac
}

case "$1" in
  status) cmd_status ;;
  get) cmd_get ;;
  set) shift; cmd_set "$@" ;;
  setmany) shift; cmd_setmany "$1" ;;
  clear) cmd_clear ;;
  preset) shift; cmd_preset "$@" ;;
  *) die "unknown command: $1" ;;
esac
