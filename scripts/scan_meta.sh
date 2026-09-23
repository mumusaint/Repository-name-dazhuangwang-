#!/system/bin/sh
# Fast scan /proc/$1/mem for IL2CPP metadata magic (AF 1B B1 FA)
PID="$1"
if [ -z "$PID" ]; then
  echo "usage: scan_meta.sh PID" >&2
  exit 1
fi

MAGIC=$(printf '\xaf\x1b\xb1\xfa')
MIN=262144
BS=1048576

scan_range() {
  START_DEC="$1"
  SIZE="$2"
  OFF=0
  while [ "$OFF" -lt "$SIZE" ]; do
    LEFT=$((SIZE - OFF))
    if [ "$LEFT" -gt "$BS" ]; then
      READ=$BS
    else
      READ=$LEFT
    fi
    ADDR=$((START_DEC + OFF))
    HIT=$(dd if="/proc/$PID/mem" iflag=skip_bytes,count_bytes skip="$ADDR" count="$READ" bs=65536 2>/dev/null \
      | grep -aobF "$MAGIC" 2>/dev/null | head -1 | cut -d: -f1)
    if [ -n "$HIT" ]; then
      FOUND=$((ADDR + HIT))
      printf "0x%x\n" "$FOUND"
      exit 0
    fi
    OFF=$((OFF + READ))
  done
}

# Pass 1: il2cpp / global-metadata named regions
while read -r line; do
  case "$line" in
    *libil2cpp*|*global-metadata*) ;;
    *) continue ;;
  esac
  REST=$(echo "$line" | awk '{print $1}')
  START=$(echo "$REST" | cut -d'-' -f1)
  END=$(echo "$REST" | cut -d'-' -f2)
  START_DEC=$((16#$START))
  END_DEC=$((16#$END))
  SIZE=$((END_DEC - START_DEC))
  [ "$SIZE" -ge "$MIN" ] || continue
  scan_range "$START_DEC" "$SIZE"
done < "/proc/$PID/maps"

# Pass 2: anon + app private readable regions
grep -E ' r' "/proc/$PID/maps" | while read -r line; do
  REST=$(echo "$line" | awk '{print $1}')
  START=$(echo "$REST" | cut -d'-' -f1)
  END=$(echo "$REST" | cut -d'-' -f2)
  NAME=$(echo "$line" | awk '{$1=$2=$3=$4=$5=""; sub(/^ +/,""); print}')
  START_DEC=$((16#$START))
  END_DEC=$((16#$END))
  SIZE=$((END_DEC - START_DEC))
  [ "$SIZE" -ge "$MIN" ] || continue
  case "$NAME" in
    /system/*|/vendor/*|/apex/*|*dalvik-CompilerMetadata*) continue ;;
  esac
  scan_range "$START_DEC" "$SIZE"
done

exit 1
