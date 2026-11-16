# 小程序宠物档案：体型移除与生命阶段

状态：本地实现与迁移验收完成；线上支持与微信开发预览分别核验。范围来自 2026-11-16 用户明确要求，不扩展头像上传、出生日期或自动年龄判定。

## 用户结果

小程序新建、编辑宠物时不再出现缺乏跨物种标准的“体型等级”，也不再默认提交等级 3。API 与数据库保留该可选字段供历史兼容：新建省略后为 null，编辑省略后保留旧值，不删除旧资料或改动官网体型界面。

生命阶段为幼年、亚成体、成体、老年，另保留待确认；亚成体使用独立的 subadult 值，不借用 juvenile 或 adult。既有 adult 的中文显示改为成体，既有枚举值不更名。旧记录出现当前客户端无法识别的阶段时，显示待确认并提示重新确认，不能误显示幼年。

用户同意按具体物种核实年月参考，缺乏可靠范围时写“年月待核实”。当前没有四阶段完整且适用于各具体物种的可靠连续范围，因此四个选项均明确标注待核实；不把性成熟年龄、平均寿命或实验动物年龄分组拼接成普适的宠物阶段标准。

## 物种与参考范围

沿用现有分类、品种或补充说明、自定义物种字段，不新增必填项。仅使用规范名称与明确别名匹配豹纹守宫、玉米蛇、虎皮鹦鹉和玄凤鹦鹉；花枝鼠使用本分类。其他描述保留为用户填写内容，未核实具体物种时显示待确认，不按“守宫”“蛇类”“鹦鹉”“蜘蛛”推断统一年龄。

当前资料核对如下。表中的年龄只是文献提供的特定观察，不用于填充四阶段年月，也不用于自动选择阶段。

| 具体对象 | 已取得资料 | 对四阶段年月的影响 |
| --- | --- | --- |
| 花枝鼠相关家养大鼠 | MSD 兽医手册给出雌雄不同的性成熟周龄和断奶时间 | 只能说明特定发育节点，不能直接确定幼年、亚成体、成体、老年的全部边界。[来源](https://www.msdvetmanual.com/all-other-pets/rats/breeding-and-reproduction-of-rats) |
| 玉米蛇 | 马里兰动物园资料给出约 1.5–3 年性成熟范围 | 该范围不等同于成体阶段的完整上下界，其他阶段仍待核实。[来源](https://www.marylandzoo.org/wp-content/uploads/2024/06/Corn-Snake-Species-Profile_June-2024.pdf) |
| 虎皮、玄凤鹦鹉 | Clinical Avian Medicine 列出物种相关发育节点及老龄区间；VCA 的虎皮资料提供另一性成熟参考 | 来源的定义与区间不能简单等同；首版不据此生成连续四阶段年月。[临床章节](https://www.ivis.org/library/clinical-avian-medicine/concepts-behavior-section-ii-early-psittacine-behavior-development)、[VCA](https://vcahospitals.com/know-your-pet/budgies---general) |
| 豹纹守宫 | 圣迭戈动物园确认物种身份及基础资料 | 本轮没有取得足以支持四阶段连续年月的资料，维持待核实。[来源](https://animals.sandiegozoo.org/animals/leopard-gecko) |
| 捕鸟蛛类 | CEC 资料区分龄期、成熟雄蛛与雌蛛后续蜕皮 | 不以一种捕鸟蛛的示例年龄代表所有蜘蛛；具体物种和四阶段范围待核实。[来源](https://www.cec.org/cites/wp-content/themes/foodwaste-theme/documents/tarantula-growth-and-development-for-educators-en.pdf) |

识别规则是界面参考索引，不是鉴定动物物种。没有出生日期、性别或经确认的物种档案时不自动推断阶段；阶段仍由主人手动选择。

## 实现与验收边界

- Prisma PetLifeStage、请求与响应 contract、应用 DTO 同步新增 subadult；通过新 migration 追加枚举值，不改写既有 migration。
- 部署顺序为数据库与 API 先支持新值，再交付会提交 subadult 的小程序预览。官网仅补充阶段选项以兼容同一 contract，不作页面改版。
- 真实 HTTP 验证新建亚成体的读回、无默认体型以及编辑后保留既有 sizeLevel。数据库验收同时包含空库、重复迁移、16 项旧迁移升级到 17 项且账号、会话和宠物行不变。
- 操作证据见 [验收记录](../operations/miniapp-life-stages-2026-11-16.md)。年龄范围待核实是已确认的产品状态，不能在交付时称为各物种标准已完成。
