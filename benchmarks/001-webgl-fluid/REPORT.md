# REA 彩色流体三模型试跑结果

**状态：三模型各 1 次试跑已完成。不是综合模型排名。**

本轮十张验收帧中，Kimi K3 与 Grok 4.7 的 RGB 像素均与受控原版完全一致。GPT 6.1 Sol 首稿也能运行，生成耗时更短，但随模拟推进，流体形状与原版出现偏差。三者都通过空白初始化、重置和两条轨迹的运行检查。

| 模型 | 实际返回模型 | 耗时 | 模型写入 / 自测 | 主场景 MAE | 新场景 MAE |
|---|---|---:|---:|---:|---:|
| Kimi K3 | k3 | 276.00 秒 | 1 / 2 | 0.000000 | 0.000000 |
| Grok 4.7 | grok-4.7-build | 279.02 秒 | 4 / 4 | 0.000000 | 0.000000 |
| GPT 6.1 Sol | gpt-6.1-sol | 192.81 秒 | 1 / 1 | 29.056146 | 6.716432 |

MAE 为各场景 5 张截图的 RGB 平均绝对差（0–255），越低越接近原版；未以此推断视觉品质或综合能力。完整每帧误差、前景误差、前景 IoU 和空白基线见 evidence/metrics.json。

## 如何查看

- web/index.html 为完整对比界面；通过 scripts/serve.py 启动本地服务器。四格顺序：原版、Kimi、Grok、GPT。
- web/comparison.mp4 是同步主场景视频（6 秒模拟，20 fps）。
- web/comparison-main-240.png 是第 4 秒同帧图；snapshots 包含全部原始截图。
- runs/<model>/engine.js 为该模型原始最终实现；没有人工代修。audit.jsonl 保存去除内部推理和个人路径后的调用元数据、测试反馈；revisions 保存模型各次写入。完整原始日志不公开。

## 实验边界

这是公开网页的 JavaScript 运行产物分析与重建，不是原生二进制逆向。官方部署脚本可直接阅读，三个模型可以分段读取；允许复用短着色器公式并保留 MIT 署名，要求自行组织引擎和接口。因此像素一致不代表从完全黑箱中推导出算法，也不代表未知输入全部等价。没有禁用 REA 的对照组，不能声称 REA 带来了多少增益。

REA 6.4.0 对同一产物执行了一次真实静态分析，缓存同一证据供三模型查询。该分析图只有 5 个节点（artifact、javascript-asset、javascript-module、unknown），没有回答模型搜索的 shader/step 细节；模型主要从随后读取的运行脚本获得数学公式。REA 的静态输出和后续 Chrome 运行验证分开保留。

模型均通过现有本地 Quotio 代理、同一自建工具循环调用；requested reasoning_effort=high。供应商注入提示和路由不同，不能保证内部推理预算相同。每模型上限 18 轮 / 32000 reported completion tokens（含 reported reasoning）/ 900 秒；全部在限额内结束。费用未返回，记为 UNKNOWN，没有按公开单价推算订阅费用。

仅单目标、每模型一次；模型预训练中是否见过公开项目 UNKNOWN。耗时包含生成、工具等待和服务负载，不能作为严格延迟排名。结果仅对应本机 Chrome / GPU / 当前运行版本。

## 原版与输入

原版核心求解器和着色器未改动。适配器移除广告、统计回调、GUI 调用、事件监听、随机初始 splat、自动动画循环；关闭 bloom/sunrays，染料短边分辨率降至512，流场短边128，保留SHADING。坐标统一为左上原点；固定640×400、dt=1/60。reset 显式清空所有原版流场缓冲。原版也应用相同约束，比较对象不是完整炫光原版。

主场景包含画圈、折返、双色相向注入及衰减；新场景使用另一条轨迹并改变 CURL/消散/半径。两场景各360步，在第60/120/180/240/360步截图。事件列表在读取模型提交物前生成并固定，见 web/scenarios.json 和 evidence/protocol-hashes.json。

## 质量检查

- 原版独立重跑两次，两场景共10个检查点原始RGBA逐字节一致。
- 三模型两场景均完成；所有采样点 JS/WebGL 运行错误为0，初始化与reset后RGB均为0。
- Kimi、Grok各10张PNG的RGB逐像素等于原版；GPT存在差异。未人工修正或替换模型实现。
- Grok共4次写入：前两次有GLSL编译错误，后两次短程测试通过；全部过程在日志中。Kimi与GPT均1次写入。
- 原版启动时有一个1281错误标志，来自启动阶段，随后清空并单独记录；正式模拟和读回错误均0。没有将启动标志误算为模型运行错误。
- 长程画面存在差异不等同于主观视觉效果差。GPT实现的精确偏差原因未用消融实验定位，保持UNKNOWN。

## 已知记录问题

artifact_read 工具返回的 sha256 错用了“splitlines 后以 LF 重组并补末尾换行”的规范化文本摘要（4dfe816c…），不是下载原始字节摘要。三个模型收到的行文本相同，原始文件未改变。模型报告里重复的这个摘要不能作为原始产物身份；以下 source-manifest.json 的真实字节SHA256和REA证据为权威。此记录问题没有通过改写历史日志掩盖。

冻结的 PROTOCOL.md 保留运行开始时的 RUNNING 字样；完成状态以本报告及 STATUS.json 为准，避免事后改变冻结协议摘要。

## 身份与复现

REA evidence_id: `ev_02b3daacd3afeef2f793ebe41068ca54593128ffda81f41598f8b90514fe28e2`
REA subject digest: `72efd8ac181b03fb69b8b287a386312a134d07cd174e1fa2bb0a0400234f20e6`

- script.js: `1acf7f41b1fe3a1b03115941ae6c741009392a236f4082fa06a91594589c7b54`；https://paveldogreat.github.io/WebGL-Fluid-Simulation/script.js
- dat.gui.min.js: `27976ca8ac2e125de97163455131890e8686ed2afc2007cd5524080b7d53ef7b`；https://paveldogreat.github.io/WebGL-Fluid-Simulation/dat.gui.min.js
- LICENSE: `1be448ae1212de2bee77b4cf851ab0acea0a7f7f32d21cd73095dd94dc173f66`；https://raw.githubusercontent.com/PavelDoGreat/WebGL-Fluid-Simulation/master/LICENSE

提交物SHA256：

- k3: `32f998428aca641446100cae9e1b82f37dcf6ecf7af4900bde81f73b85a7c085` (24260 bytes)
- grok-4.7: `60382f7e998ef55d8cfe408eb63674508ef81fc807e5148796bea4844bfa0399` (22600 bytes)
- gpt-6.1-sol: `e2a7506baf067fd8489384f92702665d0e76facc91130c0372c081a10ba9eaf6` (16547 bytes)

```sh
python3 -m http.server 8080 --directory web
# 离线验收（先在仓库根目录 npm ci，再 npx playwright install chromium）
node scripts/evaluate.cjs reference reference-repeat k3 grok-4.7 gpt-6.1-sol
python3 ../../scripts/verify.py
```

重新调用模型不是复现现有结果的必要步骤，且会再次消耗额度；公开版 run_models.py 写入独立 local-runs 目录，已存在的模型目录会拒绝覆盖。

## Public packaging

原始冻结协议不变；公开脚本仅做环境变量配置、浏览器依赖和输出隔离移植，尚未用这些移植脚本重新调用付费模型。protocol-hashes.json 中的 runner 摘要对应历史本地版本，不对应移植版。内部推理、完整私有日志、原始本机路径和RGBA中间文件不公开。原始最终 engine.js、PROMPT.txt、PROTOCOL.md、场景与验收截图保持字节不变。
