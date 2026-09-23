/**
 * 天下布魔 com.pinkcore.tkfm — 从内存 dump 解密后的 global-metadata.dat
 * 兼容 Frida 17+ API
 */

"use strict";

const OUT = "/sdcard/Download/tkfm-global-metadata.dat";
let dumped = false;

function findModExport(moduleName, exportName) {
  if (moduleName) {
    try {
      const mod = Process.findModuleByName(moduleName);
      if (mod) {
        const addr = mod.findExportByName(exportName);
        if (addr) return addr;
      }
    } catch (e) {}
  }
  try {
    if (typeof Module.findGlobalExportByName === "function") {
      return Module.findGlobalExportByName(exportName);
    }
  } catch (e) {}
  return null;
}

function logModules() {
  const keys = ["libil2cpp.so", "libunity.so", "libmain.so", "lib39285EFA.so"];
  let found = false;
  for (const name of keys) {
    try {
      const m = Process.findModuleByName(name);
      if (m) {
        console.log("[*] module " + name + " @ " + m.base + " size=" + m.size);
        found = true;
      }
    } catch (e) {}
  }
  if (!found) {
    console.log("[!] 本进程未加载 libil2cpp/libunity — 可能附加到了错误子进程");
    console.log("[!] 请 Ctrl+C 退出，重新运行 run_frida_attach.ps1");
  }
}

function validateMetadataHeader(base) {
  try {
    const magic = base.readU32();
    const ver = base.add(4).readU32();
    if (magic !== 0xfab11baf) return false;
    if (ver < 16 || ver > 40) return false;
    const size = Process.pointerSize === 8 ? base.add(8).readU32() : 0;
    const slo = base.add(8).readU32();
    if (slo > 0 && slo < 0x10000000) return true;
    return true;
  } catch (e) {
    return false;
  }
}

function findMetadataBase() {
  const pattern = "af 1b b1 fa";
  const minSize = 0x40000;
  let ranges = [];
  try {
    ranges = Process.enumerateRanges({ coalesce: true });
  } catch (e) {
    ranges = Process.enumerateRanges("r--");
  }

  for (const range of ranges) {
    if (range.size < minSize) continue;
    const prot = range.protection || "";
    if (prot.indexOf("r") === -1) continue;
    try {
      const hits = Memory.scanSync(range.base, range.size, pattern);
      for (const hit of hits) {
        if (validateMetadataHeader(hit.address)) {
          const ver = hit.address.add(4).readU32();
          console.log("[+] metadata @ " + hit.address + " ver=" + ver + " prot=" + prot);
          return hit.address;
        }
      }
    } catch (e) {}
  }
  return null;
}

function estimateSize(base) {
  const maxGuess = 16 * 1024 * 1024;
  const hdr = base.readByteArray(128);
  const view = new DataView(hdr);
  let maxOff = 0;
  for (let i = 8; i < 128; i += 4) {
    const v = view.getUint32(i, true);
    if (v > maxOff && v < maxGuess) maxOff = v;
  }
  return Math.min(Math.max(maxOff + 0x200000, 0x600000), maxGuess);
}

function dumpOnce(label) {
  if (dumped) return true;
  const base = findMetadataBase();
  if (!base) {
    console.log("[-] " + label + ": 未找到 FAB11BAF");
    return false;
  }
  try {
    const size = estimateSize(base);
    console.log("[+] dump " + size + " bytes from " + base);
    const buf = base.readByteArray(size);
    const f = new File(OUT, "wb");
    f.write(buf);
    f.flush();
    f.close();
    dumped = true;
    console.log("[+] 成功写入 " + OUT);
    return true;
  } catch (e) {
    console.log("[-] dump 失败: " + e);
    return false;
  }
}

function hookIl2CppInitIn(lib) {
  try {
    const init = findModExport(lib, "il2cpp_init");
    if (!init) return false;
    Interceptor.attach(init, {
      onLeave() {
        console.log("[*] il2cpp_init returned");
        setTimeout(function () { dumpOnce("post-init"); }, 2500);
      },
    });
    console.log("[+] hooked il2cpp_init in " + lib);
    return true;
  } catch (e) {
    return false;
  }
}

function watchLibraryLoad() {
  if (hookIl2CppInitIn("libil2cpp.so")) return;
  const names = ["android_dlopen_ext", "dlopen"];
  const libs = ["libdl.so", "linker64", "linker"];
  for (const lname of names) {
    let sym = null;
    for (const lib of libs) sym = findModExport(lib, lname) || sym;
    if (!sym) sym = findModExport(null, lname);
    if (!sym) continue;
    Interceptor.attach(sym, {
      onEnter(args) {
        try { this.path = args[0].readCString(); } catch (e) { this.path = null; }
      },
      onLeave() {
        if (this.path && this.path.indexOf("il2cpp") !== -1) {
          console.log("[*] loaded: " + this.path);
          setTimeout(function () { hookIl2CppInitIn("libil2cpp.so"); }, 500);
        }
      },
    });
    console.log("[+] watching " + lname);
    return;
  }
}

function startPolling() {
  let tries = 0;
  const timer = setInterval(function () {
    tries++;
    if (dumpOnce("poll-" + tries)) {
      clearInterval(timer);
      return;
    }
    if (tries % 5 === 0) {
      console.log("[*] 等待 metadata… (" + tries + "/120) — 可在游戏里点「召唤」触发加载");
    }
    if (tries >= 120) {
      console.log("[-] 超时：换一个有 [il2cpp] 标记的 PID 重试");
      clearInterval(timer);
    }
  }, 3000);
}

console.log("[*] metadata dumper | pid=" + Process.id + " | " + Process.arch);
logModules();
watchLibraryLoad();
startPolling();

try {
  if (Java.available) Java.perform(function () { console.log("[*] Java VM OK"); });
} catch (e) {}
