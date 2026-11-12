import { describe, expect, it } from "vitest";
import { loginCodeMail } from "./mail";

describe("the sign-in code's email", () => {
  it("says the code, the site and how long it works, word for word", () => {
    expect(loginCodeMail("123456", 10)).toEqual({
      subject: "123456 是你的舟P地图登录验证码",
      text: "你的登录验证码是：123456\n\n10 分钟内有效。如果不是你本人在登录，忽略这封邮件就好。",
      html: `<div style="font-family:sans-serif;font-size:15px;line-height:1.6">
<p>你的舟P地图登录验证码是：</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">123456</p>
<p style="color:#6b7280">10 分钟内有效。如果不是你本人在登录，忽略这封邮件就好。</p>
</div>`,
    });
  });
});
