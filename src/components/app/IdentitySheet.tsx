"use client";

import type { Identity } from "@/lib/world/types";
import Sheet from "./Sheet";

const GROUPS: [Identity["group"], string][] = [
  ["me", "你自己"],
  ["tester", "测试玩家"],
  ["passerby", "被碰过的路人蟑螂"],
];

export default function IdentitySheet({
  identities,
  onBecome,
  onReset,
  onClose,
}: {
  identities: Identity[];
  onBecome: (id: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="切换测试身份" onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        现在所有数据都只存在这台设备的浏览器里。切换身份就像换个账号登录，一个人就能试完触须、被碰提示和独立宣言。上海的几位测试玩家彼此都在
        10 公里内。
      </p>
      {GROUPS.map(([group, title]) => {
        const list = identities.filter((i) => i.group === group);
        if (!list.length) return null;
        return (
          <div key={group}>
            <h3>{title}</h3>
            {list.map((i) => (
              <div className="list-row" key={i.id}>
                <div>
                  <strong>{i.label}</strong>
                  {i.unseen > 0 && <span className="badge">{i.unseen}</span>}
                  <p className="muted">{i.note}</p>
                </div>
                <div className="row-actions">
                  {i.current ? (
                    <span className="hint" style={{ margin: 0 }}>
                      当前
                    </span>
                  ) : (
                    <button className="pill dark" onClick={() => onBecome(i.id)}>
                      切换
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })}
      <button className="danger wide" style={{ marginTop: 20 }} onClick={onReset}>
        清空本地测试数据，从头开始
      </button>
    </Sheet>
  );
}
