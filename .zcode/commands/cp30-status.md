---
description: CP30 全栈健康检查（只读）：六服务、前端、数据库 intent/attempts、日志异常，输出一份状态报告
---

# CP30 状态检查

依次执行以下**只读**检查（禁止任何写操作、禁止重启服务），最后汇总成一份状态报告。已知背景噪声：`BUSINESS_CODEC_UNAVAILABLE` / `LIVE_STEP_FAILED`（废弃 fund intent 轮转报错），报告里单独标注、不算异常。

## 1. 服务进程

```bash
pgrep -fl 'mf-cp30|isolated-entry' | head -20
```

预期六服务在跑：automatic-business / controller / application / identity / registrar / security。缺哪个报哪个。

## 2. 前端入口

```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://localhost:16443/
```

预期 200。非 200 或连接拒绝则报服务层问题。

## 3. 数据库最近 intent

```bash
PGPASSWORD=$(cat /Users/mili/.mf-cp30-20261013/bootstrap-password) \
  /opt/homebrew/Cellar/postgresql@17/17.11/bin/psql \
  -h /Users/mili/.mf-cp30-20261013/socket -U c1_connection_bootstrap -d c1_connection \
  -c "select action, stage, transaction_hash, created_at from c1_live_private.intents order by created_at desc limit 10;"
```

若列名不符，先 `\d c1_live_private.intents` 看真实结构再调整查询。

## 4. attempts 残留（ORIGINAL_PRIVATE_UNKNOWN 卡点相关）

先 `\d c1_runtime_private.attempts` 看结构，再查最近 10 行，重点找**有行但 transaction_hash 为空**的残留（send_original 永久抛 ORIGINAL_ATTEMPT_UNKNOWN 的嫌疑条件）。如存在已知卡点 opId `0x033ad0d11121c1ce2b2345466f4b4c2de2700498a278f7eea573145b04b7a628`，单独报告其状态。

## 5. 业务日志尾部

```bash
tail -50 "$(ls -t /Users/mili/.mf-cp30-20261013/logs/automatic-business-*.log | head -1)"
```

找 C1_DIAGNOSTIC 与 error 级别行，区分真实异常与背景噪声。

## 6. PG 权限错误

```bash
tail -200 $(ls -t /Users/mili/.mf-cp30-20261013/logs/pg*.log 2>/dev/null | head -1) 2>/dev/null | grep -i 'permission denied' | tail -10
```

（路径不符时 `ls /Users/mili/.mf-cp30-20261013/logs/` 找 pg 日志。）permission denied 是缺 GRANT 类问题的第一信号（参照 043 first_binding_material 热修复先例）。

## 7. 汇总报告格式

- 服务：X/6 在跑，缺哪些
- 前端：HTTP 状态
- 最新 intent：publish/setListed 等各处于什么 stage、有无 transaction_hash
- attempts 残留：有无、涉及 opId
- 异常信号：真实异常 vs 背景噪声分开列
- 建议下一步：一句话，指向 `.zcode/skills/cp30-ops/SKILL.md` 对应剧本
