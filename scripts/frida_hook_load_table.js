/**
 * Frida：hook GData 读表（需已 root / MuMu adb root）
 *
 * 用法（PC，Frida 17+ 勿用 --no-pause）：
 *   frida -U -f com.pinkcore.tkfm -l scripts/frida_hook_load_table.js
 * 或 attach 已运行的游戏：
 *   frida -U -n com.pinkcore.tkfm -l scripts/frida_hook_load_table.js
 *
 * 说明：符号名为 il2cpp 导出，若被 strip 需先用 Zygisk dump.cs 替换类名/偏移。
 */
"use strict";

const PKG = "com.pinkcore.tkfm";
const TARGETS = [
  "LoadCharLvUpData",
  "LoadPotentialUpData",
  "LoadRareUpData",
  "LoadLvUpData",
  "LoadBinaryDataWithCAsync",
];

function tryIl2CppResolve(name) {
  if (typeof Il2Cpp !== "undefined" && Il2Cpp.api) {
    try {
      const asm = Il2Cpp.domain.assembly("Assembly-CSharp");
      if (!asm) return null;
      const klass = asm.image.class("GData");
      if (!klass) return null;
      const m = klass.method(name);
      if (m) return m.virtualAddress;
    } catch (e) {}
  }
  return null;
}

function hookNative(name, addr) {
  console.log("[+] hook " + name + " @ " + addr);
  Interceptor.attach(addr, {
    onEnter() {
      console.log("[call] " + name);
    },
    onLeave(retval) {
      console.log("[ret ] " + name + " -> " + retval);
    },
  });
}

function main() {
  console.log("Frida Il2Cpp table hook for " + PKG);
  let hooked = 0;
  for (const name of TARGETS) {
    const addr = tryIl2CppResolve(name);
    if (addr) {
      hookNative(name, addr);
      hooked++;
    } else {
      console.log("[-] miss " + name + " (need il2cpp bridge or Zygisk dump.cs)");
    }
  }
  if (hooked === 0) {
    console.log("[!] 未 hook 到任何方法。请先 Zygisk-Il2CppDumper 生成 dump.cs，");
    console.log("    或使用 frida-il2cpp-bridge 解析 GData 方法地址。");
  }
}

setImmediate(main);
