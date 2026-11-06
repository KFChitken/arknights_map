"use client";

import type { Identity } from "@/lib/world/types";
import Sheet from "./Sheet";

const GROUPS: [Identity["group"], string][] = [
  ["me", "你自己"],
  ["tester", "测试玩家"],
  ["passerby", "被碰过的路人蟑螂"],
];

/** 假装离开 this long: one of each of her five bands */
const LEFT: [string, number][] = [
  ["20 分钟", 20 * 60],
  ["5 小时", 5 * 3600],
  ["2 天", 2 * 86400],
  ["9 天", 9 * 86400],
  ["20 天", 20 * 86400],
];

export default function IdentitySheet({
  identities,
  onBecome,
  onReset,
  onPretend,
  onPretendLeft,
  onAskAgain,
  onClose,
}: {
  identities: Identity[];
  onBecome: (id: string) => void;
  onReset: () => void;
  /** Move this identity's days back, then reload: 阿米娅向导 greets again, or 欢迎回家 shows */
  onPretend: (what: "day" | "away") => void;
  /** 假装离开 that many seconds, then reload: 佩丽卡监督 says how long */
  onPretendLeft: (seconds: number) => void;
  /** 让佩丽卡重新问一次: forget the answer to her question */
  onAskAgain: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet title="切换测试身份" onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        开发测试用：切换身份就像换个账号登录，一个人就能试完触须、被碰提示、独立宣言和触须之交。上海的几位测试玩家彼此都在 10
        公里内。正式上线时这个按钮不会出现。
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
      <h3>假装时间过去了</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        给当前身份用，点完页面会自己刷新。「过了一天」：阿米娅向导会再打一次招呼（要先和她成为触须之交）；「离开两天」：弹「欢迎回家」小结。
      </p>
      <div className="row-actions">
        <button className="pill" onClick={() => onPretend("day")}>
          假装过了一天
        </button>
        <button className="pill" onClick={() => onPretend("away")}>
          假装离开两天
        </button>
      </div>
      <h3>假装离开</h3>
      <p className="hint" style={{ marginTop: 0 }}>
        佩丽卡监督的离开计时，要先让她开始记时间。20 分钟、5 小时：顶上冒横幅；2 天以上：她那句在「欢迎回家」小结里。
      </p>
      <div className="row-actions" style={{ flexWrap: "wrap" }}>
        {LEFT.map(([label, seconds]) => (
          <button key={label} className="pill" onClick={() => onPretendLeft(seconds)}>
            {label}
          </button>
        ))}
        <button className="pill" onClick={onAskAgain}>
          让佩丽卡重新问一次
        </button>
      </div>
      <button className="danger wide" style={{ marginTop: 20 }} onClick={onReset}>
        清空测试数据，从头开始
      </button>
    </Sheet>
  );
}
