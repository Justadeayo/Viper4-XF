##########################################################################################
#
# MMT Extended Config Script
#
##########################################################################################

##########################################################################################
# Config Flags
##########################################################################################

# Uncomment and change 'MINAPI' and 'MAXAPI' to the minimum and maximum android version for your mod
# Uncomment DYNLIB if you want libs installed to vendor for oreo+ and system for anything older
# Uncomment DEBUG if you want full debug logs (saved to /sdcard)
#MINAPI=21
#MAXAPI=25
DYNLIB=true
#DEBUG=true

##########################################################################################
# Replace list
##########################################################################################

# List all directories you want to directly replace in the system
# Check the documentations for more info why you would need this

# Construct your list in the following format
# This is an example
REPLACE_EXAMPLE="
/system/app/Youtube
/system/priv-app/SystemUI
/system/priv-app/Settings
/system/framework
"

# Construct your own list here
REPLACE="
"

##########################################################################################
# Permissions
##########################################################################################

set_permissions() {
  set_perm_recursive $MODPATH$LIBDIR/lib/soundfx 0 0 0755 0644
  chcon -R u:object_r:vendor_file:s0 $MODPATH$LIBDIR/lib/soundfx 2>/dev/null
  if [ "$IS64BIT" ]; then
    set_perm_recursive $MODPATH$LIBDIR/lib64/soundfx 0 0 0755 0644
    chcon -R u:object_r:vendor_file:s0 $MODPATH$LIBDIR/lib64/soundfx 2>/dev/null
  fi
  set_perm $MODPATH/bin/viperctl.sh 0 0 0755
  set_perm_recursive $MODPATH/webroot 0 0 0755 0644
}

##########################################################################################
# MMT Extended Logic - Don't modify anything after this
##########################################################################################

SKIPUNZIP=1
unzip -qjo "$ZIPFILE" 'common/functions.sh' -d $TMPDIR >&2
. $TMPDIR/functions.sh
if [ -n "$KSU" ] || [ -n "$APATCH" ]; then
  touch $MODPATH/skip_mount
  touch $MODPATH/skip_mountify
else
  rm -f $MODPATH/skip_mount $MODPATH/skip_mountify
fi
