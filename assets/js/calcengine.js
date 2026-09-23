/** 统一精确打桩计算入口（TenkaAssist calculator + autoCalc） */
const CalcEngine = (function () {
  const ACTIONS_REQUIRED = 13 * 5;
  const DEFAULT_OPTIONS = { hitAll: true, bossElement: -1, optionList: null };
  let savedGetCharacter = null;

  function useOfficialCharacterData() {
    if (typeof character_map === "undefined") return false;
    if (!savedGetCharacter) savedGetCharacter = window.getCharacter;
    // 与 TenkaAssist make.js 一致：精确打桩只用 character_map 原始数值
    window.getCharacter = function (id) {
      const n = Number(id);
      if (character_map.has(n)) return character_map.get(n);
      return savedGetCharacter?.(n);
    };
    return true;
  }

  function restoreGetCharacter() {
    if (savedGetCharacter) {
      window.getCharacter = savedGetCharacter;
      savedGetCharacter = null;
    }
  }

  /** 批量重算前重置全局状态，避免上一次模拟残留影响伤害 */
  function resetEngineState() {
    if (typeof hitAll !== "undefined") hitAll = true;
    if (typeof dmg13 !== "undefined") dmg13 = 0;
    if (typeof GLOBAL_TURN !== "undefined") GLOBAL_TURN = 1;
    if (typeof comp !== "undefined" && Array.isArray(comp)) comp.length = 0;
    if (typeof boss !== "undefined" && boss) {
      boss.hp = boss.maxHp;
      boss.def = false;
      if (Array.isArray(boss.buff)) boss.buff.length = 0;
      if (Array.isArray(boss.li)) boss.li.length = 0;
    }
    if (typeof buff_ex !== "undefined") {
      buff_ex.length = 0;
      buff_ex.push("도트뎀");
    }
  }

  function countCommandActions(description) {
    if (!description || description.length < 10) return 0;
    return description
      .split("\n")
      .flatMap((line) => line.match(/\d+[평궁방]/g) || [])
      .length;
  }

  function isEngineReady() {
    return typeof autoCalc === "function" && typeof boss !== "undefined";
  }

  function waitUntilReady(maxMs = 10000) {
    if (isEngineReady()) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (isEngineReady()) return resolve(true);
        if (Date.now() - start >= maxMs) {
          return reject(new Error("计算引擎加载超时，请刷新页面"));
        }
        setTimeout(tick, 80);
      };
      tick();
    });
  }

  function mergeOptions(options = {}) {
    return { ...DEFAULT_OPTIONS, ...options };
  }

  function runPreciseCalc(idList, command, bondList, options = {}) {
    const result = { dmg13: 0, valid: false, actionCount: 0, error: null };
    const opts = mergeOptions(options);

    if (!isEngineReady()) {
      result.error = "引擎未加载";
      return result;
    }
    if (!idList || idList.length !== 5) {
      result.error = "需要 5 人编队";
      return result;
    }

    result.actionCount = countCommandActions(command);
    if (result.actionCount < ACTIONS_REQUIRED) {
      result.error = `出招序列不完整（${result.actionCount}/${ACTIONS_REQUIRED}）`;
      return result;
    }

    const bonds = bondList?.length === 5 ? bondList : Array(5).fill(5);

    useOfficialCharacterData();
    resetEngineState();

    try {
      hitAll = opts.hitAll !== false;
      const dmg =
        autoCalc(idList, command, bonds, opts.bossElement, opts.optionList) || 0;
      result.dmg13 = dmg;
      result.valid = dmg > 0;
      if (!result.valid) result.error = "计算返回 0（序列或角色可能无效）";
      return result;
    } catch (e) {
      result.error = e.message || "计算错误";
      console.error("CalcEngine", e);
      return result;
    } finally {
      hitAll = true;
      restoreGetCharacter();
    }
  }

  function calc13t(idList, command, bondList, options) {
    return runPreciseCalc(idList, command, bondList, options).dmg13;
  }

  /** 模拟将某角色加入池子后的羁绊映射 */
  function bondMapWithPull(bondMap, pullIds, pullBond = 1) {
    const next = new Map(bondMap);
    for (const id of pullIds) next.set(id, pullBond);
    return next;
  }

  /** 模拟某角色羁绊 +1 后的映射 */
  function bondMapWithUpgrade(bondMap, charId) {
    const next = new Map(bondMap);
    const cur = next.get(charId) || 1;
    if (cur < 5) next.set(charId, cur + 1);
    return next;
  }

  /** 模拟某角色羁绊升至目标花数 */
  function bondMapWithTarget(bondMap, charId, toBond) {
    const next = new Map(bondMap);
    const cur = next.get(charId) || 1;
    next.set(charId, Math.min(5, Math.max(cur, toBond)));
    return next;
  }

  function estimateDmgFromOfficial(officialDmg, bondList) {
    if (!officialDmg || !bondList?.length) return 0;
    const mul = (b) => 1 + (b - 1) * 0.08;
    const ref = Math.pow(mul(5), 5);
    const actual = bondList.map(mul).reduce((a, b) => a * b, 1);
    return Math.round(officialDmg * (actual / ref));
  }

  return {
    runPreciseCalc,
    calc13t,
    estimateDmgFromOfficial,
    countCommandActions,
    isEngineReady,
    waitUntilReady,
    resetEngineState,
    bondMapWithPull,
    bondMapWithUpgrade,
    bondMapWithTarget,
    ACTIONS_REQUIRED,
    DEFAULT_OPTIONS,
  };
})();
