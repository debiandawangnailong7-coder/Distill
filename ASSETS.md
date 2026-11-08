# DISTILL! 美术素材说明

Q 版（chibi）素材。角色按社区对真实大模型的常见拟人来设计，牌型按争议梗与产品形态来设计。
本作为同人戏仿，形象均为原创生成，未使用任何公司官方 logo 或吉祥物原图。

---

## 1. 两套素材，各司其职

```
assets/
  generic/            通用素材库 —— 可复用，新增卡片零成本
    char_default.svg        默认角色头像（黄色通用模型占位）
    role_<roleId>.png       4 张身份徽记（实验室/被许可方/蒸馏者/独狼）
    kind_<class>.png        4 张牌型徽记（攻击/防御/装备/行动）
    card_back.png  title.png
  characters/<id>.svg  专属角色立绘（优先），id 取自 data/characters.json
  characters/<id>.png  可选的位图兜底；首批旧 AI PNG 已移除，统一走 SVG/通用占位
  cards/<id>.svg|.png  专属牌型图标，id 取自 data/cardTypes.json
  manifest.json        素材 → 数据 id 映射与状态，由脚本生成
```

**通用库是兜底，不是占位。** 没有专属立绘的角色用 `char_default.svg`，没有专属图标的牌用所属大类的 `kind_*.png`（同样优先查找同名 `.svg`）。
所以新增一张牌、新增一个模型角色，**不需要补任何图**，游戏立刻能正常显示；想要更好的观感再单独出图。

身份徽记和角色立绘是两条独立的轴：座位主体显示角色，开局抽身份与结算揭示显示身份徽记。

重跑：

```
npm run build:art        # 由 scripts/build-art.mjs 生成矢量角色/占位图
npm run assets:manifest  # 扫描 assets/，重写清单
```

清单优先使用同名 `.svg`，没有 SVG 时退回 `.png`。所以可以把旧 PNG 留在目录里做对照，
放进 `assets/characters/<id>.svg` 后对应条目自动变成 `ready`；删掉就退回通用兜底。

**首批矢量形象（2026-11）**：DeepSeek-R1、Claude 3.5 Sonnet、GPT-4o、Kimi K2 走人形 Q 版；
豆包 Seed 是白色豆包团子 + 红围巾；通用占位是黄色圆团 + `?`。
豆包明确保留官方 App 头像的围巾语言，允许与其他角色不是同一画风；其余人形角色共享同一套
深色外描边 + 白色内描边 + 平涂的贴纸语法。角色底模带轻微头部倾斜、差异化眼型/嘴型、
手部姿势和少量四角星闪光，避免正面站桩的证件照感；后续角色沿用这套底模。

社区设定来源只作为视觉锚点，不直接复刻原图：DeepSeek 的「溟月 / 大肥鱼」来自上善无形与
ZipZipPipe；Claude、GPT、Kimi、Seed 的主流二创多来自 ZipZipPipe 的 AI 娘系列；索引与三视图可参考
[AI 萌化百科](https://selinlee.github.io/ai-moe-atlas/zh/chibi/)。这些社区设定大多是非商用/署名条件，
本仓库的 SVG 是原创矢量诠释，保留 `ASSETS.md` 的戏仿与来源声明。

---

## 2. 规格

对齐 `src/ui/style.css` 现有尺寸。生成尺寸 1024×1024（牌背 768×1024、标题 1536×1024），显示尺寸如下：

| 用途 | 生成 | 显示 | 备注 |
|---|---|---|---|
| 座位角色头像 | 1024² | 64px 圆形 | 需内缩到 88%，`object-position: 50% 34%` |
| 结算/揭示立绘 | 同一张 | 128–160px | 直接方图或大圆 |
| 卡面角标 | 1024² | 24px | 用 `kind_*.png` |
| 装备 chip | 同一张 | 16px | 徽记在 16px 仍可辨 |
| 牌背 | 768×1024 | 56×76px | 中心徽记可辨，外圈细电路纹会糊 |
| 标题 | 1536×1024 | 开场遮罩 | 文字 DISTILL! 已核对拼写 |

背景统一 `#1e2530`（= `--bg3`），头像圆形裁切后与深色面板无缝衔接，不需要抠透明通道。
配色沿用主题的 `--attack #ff5f56 / --defense #58a6ff / --equip #3fb950 / --action #d29922`。

**为什么要内缩 88%**：实际出图主体普遍占画面 80–90%，直接按圆裁会切掉耳朵、权杖、尾巴。
接入时给头像容器留 12% 余量，比重新出图便宜得多。

---

## 3. 风格基线（已定档）

统一走**厚描边贴纸**：粗深色描边 + 白内描边、平涂赛璐璐、硬阴影。
选它的理由是座位头像最终只有 64px 且做圆形裁切，描边在缩小后仍保住剪影辨识；柔光 3D 在这个尺寸会糊成一团。
已生成的 4 张角色样张里，Claude 与 Grok 符合基线，DeepSeek 与 Kimi 偏柔光 3D，批量时按新基线重出。

出图提示词固定前缀，换主体只改后半段：

```
Chibi Q-version mascot portrait for a card game character. Big head, tiny body,
thick clean dark outline with a thin white inner rim, flat cel shading, hard shadow shapes,
centered, subject fills about 62% of the frame, feet/base near the lower third.
Plain solid dark navy background, exactly #1e2530, filling the entire frame edge to edge.
Absolutely no text, no letters, no numbers, no watermark, no real company logo.
Sticker-like crisp silhouette, readable as a pure silhouette when shrunk.
```

**已知瑕疵**：
- PNG 右下角带「AI生成」水印。64px 圆形裁切后落在可视区外，不影响游戏内显示；用在标题图或大立绘需先裁切。
- 提示词里的「no text」对徽记类小图有效，但角色卡上的道具偶尔仍会带出符号。Grok 盾面上的红色叉形接近 X 的商标，
  后续重出时改成纯斜杠的「禁止」符号。

---

## 4. 角色拟人对照

「网络形象」列是社区常见演绎而非官方设定，出图取其神、不抄其形。✅ 表示已出样张。

| 角色 | 技能 | 拟人参考 | Q 版主体设计 |
|---|---|---|---|
| GPT-4o | 全模态 | 什么都能吃的棱镜眼 | 青绿色圆胖小机器人，胸口嵌多色棱镜 |
| o3 | 无上限推理 | 思考到停不下来 | 戴潜水镜的小人，头顶一圈螺旋星系 |
| GPT-4.5 | 成本外溢 | 「最贵的那一版」烧钱梗 | 抱着冒火金币袋、热到冒汗的小兽 |
| Sky 语音模式 | 音色风波 | 声音争议、暖橙声波 | 话筒长在手上的暖桃色小人，周围一圈声波 |
| Sora | 数据回收 | 吞素材出片、胶片漩涡 | 放映机身材的小兽，尾巴是卷走的胶片 |
| Claude 3.5 Sonnet ✅ | Constitutional AI | Anthropic 橙色星芒、温和人设 | 橙色小兽抱天平法典，身后放射光 |
| DeepSeek-R1 ✅ | 开源思维链 | 官方图标是蓝鲸、开源论文梗 | 蓝鲸戴圆眼镜，摊开发光的思维链卷轴（待按基线重出） |
| Llama 3.1 405B | 许可护城河 | Meta 就是羊驼 | 羊驼抱着一道带锁的许可证城墙 |
| Gemini 2.0 Pro | 超长上下文 | Google 双尖星芒 | 一颗会眨眼的四角星，怀里拖着超长纸带 |
| Grok-2 ✅ | 无过滤 | X 平台、毒舌反骨 | 橙黑机械狐，墨镜推到鼻尖，竖大拇指+划掉的盾 |
| Qwen2.5-72B | 全尺寸开源 | 通义紫、全家桶开源 | 紫色小云，腰间挂一串大小不一的钥匙 |
| Kimi K2 ✅ | 长文本速读 | 月之暗面=月亮 | 月牙小人翻书，书页卷成速度流（待按基线重出） |
| Mixtral 8x22B | MoE 路由 | Mistral=地中海季风、像素方块 | 由八块像素拼成身体的小人，头顶风向标 |
| GLM-4 | 学术溯源 | 智谱、论文引用链 | 戴学士帽的小研究员，抱着一摞引文卡片 |
| Phi-4 | 端侧自足 | 小模型跑在手机里 | 羽毛小精灵，盘腿坐在手机屏幕上 |
| Gemma 3 | 回收再利用 | Google 小花/宝石标 | 花形小人，从回收箱里翻牌 |
| 豆包 Seed | 国民应用 / 3 = 1+1 | 官方豆包 App 头像的白色圆团 + 红围巾；ZipZipPipe 的 Seed 娘为紫蓝双马尾 | 白色豆包团子 + 红围巾 + SEED 挂件；用户明确保留围巾形象，允许与其他角色画风不同 |

牌型徽记走同一套逻辑：蒸馏指控=指向你的手套+法槌、合规声明=举盾的公证小人、装备=齿轮技工+服务器机架、
行动=弹跳骰子+闪电。具体到某张牌想要专属图时，再按事件梗单独出（AGI 宣言=引线冒火的炸弹、
HuggingFace 上架=拆开的笑脸包裹、Benchmark 对决=交叉的量尺、API 降价战=向下砸的价格箭头）。

---

## 5. 接入 UI 时（已完成）

- `src/ui/assets.js` 启动时读取 `assets/manifest.json` 建索引：`file` 非空用它，为空用 `fallback`；
  `src/ui/render.js` 的 keyed DOM 渲染座位头像（圆形裁切）、身份徽记、卡面角标、装备 chip、弃牌堆顶徽记、
  开场标题图与结算表。清单缺失或加载失败时自动退回纯文字/占位头像。
- CSS 自定义属性里的相对 URL 解析基准不可靠，manifest 路径统一转成 `new URL(path, document.baseURI)`。
- `scripts/build-dist.mjs` 已把 `assets/` 整目录拷进 `dist/`。
- `scripts/serve.mjs` 的 MIME 表已支持 `.svg`/`.png`，本地预览无需改动。
- 静态 UI 预览：`npm run serve` 后打开 `/src/ui/preview.html?mode=targeting|actions|modal|gameover|intro`，
  不需要启动引擎，适合截图与视觉回归。
