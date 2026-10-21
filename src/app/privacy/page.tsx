import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME } from "@/lib/rules";

export const metadata: Metadata = { title: `隐私说明 · ${SITE_NAME}` };

export default function Privacy() {
  return (
    <main className="doc">
      <h1>{SITE_NAME}隐私说明（草稿）</h1>
      <p className="hint">这是内测阶段的草稿，正式上线前会再更新。</p>

      <h2>我们保存什么</h2>
      <ul>
        <li>你的邮箱：只用来发登录验证码，别人看不到。</li>
        <li>你填的资料：名字（可以保持匿名）、玩的游戏、厨力角色、游戏 UID（可选）、蟑螂形象和颜色。</li>
        <li>你放下的蟑螂本体和克隆体的位置，以及挪窝、收回的记录（雷达用来统计数量）。</li>
        <li>触须、独立宣言和触须之交的记录。</li>
      </ul>
      <p>注册时问的出生年月只用来确认你已满 14 岁，不会保存。网站不会读取你设备的定位。</p>

      <h2>别人能看到什么</h2>
      <ul>
        <li>地图上：你放下蟑螂的确切位置和蟑螂的样子，但看不出是谁。请不要把蟑螂放在家门口或别的能认出你的地方。</li>
        <li>克隆体在别人看来都长一样，看不出属于哪只本体。</li>
        <li>你大胆伸出触须时，对方能看到你的资料；偷偷伸出触须时，对方只知道被碰了一下。</li>
        <li>游戏 UID 默认谁都看不到，只有你打开分享后，你大胆碰过的人才看得到。</li>
        <li>成为触须之交后，对方能看到你的蟑螂、宣言次数和社交记录；里面的其他人保持匿名。</li>
        <li>独立宣言只告诉收到的人“10 公里内有舟p”，不会说是谁、在哪。</li>
      </ul>

      <h2>年龄</h2>
      <p>目前只开放给 14 岁及以上的玩家。</p>

      <h2>删除</h2>
      <p>在「资料」里点「注销账号」，你的账号和所有数据（资料、蟑螂、触须、宣言、触须之交）会立即删除。</p>

      <p className="hint">
        {SITE_NAME}是非官方的同人项目，与鹰角网络无关。<Link href="/">回到地图</Link>
      </p>
    </main>
  );
}
