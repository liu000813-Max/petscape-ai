'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import {
  Tldraw,
  StateNode,
  DefaultToolbar,
  type DefaultToolbarProps,
  SelectToolbarItem,
  HandToolbarItem,
  DrawToolbarItem,
  TextToolbarItem,
  EraserToolbarItem,
  createShapeId,
  toRichText,
  startEditingShapeWithRichText,
  Box,
  useEditor,
  useValue,
  type Editor,
  type TLShapeId,
  type TLAssetId,
  type TLArrowShape,
  type TLImageShape,
  type TLComponents,
  type TLUiOverrides,
  type TLPointerEventInfo,
  AssetRecordType,
} from 'tldraw';
import 'tldraw/tldraw.css';
import type { CanvasItem } from '../lib/types/project';

// 每张场景卡的画布尺寸与横向铺排步长
const CARD_W = 236;
const CARD_H = 236;
const GAP_X = 60;
const START_X = 80;
const START_Y = 80;

// 标注色：spec 定案 #D64533（tailwind token `anno`）。tldraw 箭头颜色走内置调色板枚举，
// 不支持按 shape 传任意 hex；'red' 是调色板里视觉上最接近 #D64533 的项（不做自定义主题，避免视觉重构）。
const ANNOTATION_TOOL_ID = 'petscape-annotation';
const ANNOTATION_TOOL_LABEL = '标注';
const ANNOTATION_MIN_LENGTH = 8;

// canvasItems 是内容真相源：每个 ready item 用确定性 shapeId 落一个 image shape。
// tldraw snapshot 只承载布局（位置/相机），刷新时先 restore snapshot 再补建缺失的卡。
function shapeIdForItem(item: CanvasItem): TLShapeId {
  return createShapeId(`scene-${item.id}`);
}
function assetIdForItem(item: CanvasItem): TLAssetId {
  return AssetRecordType.createId(item.id.replace(/-/g, '').slice(0, 24));
}
// 派生连线用确定性 id（从 parentId+childId 派生），刷新后按 canvasItems 重建，不依赖 snapshot。
function derivedLinkShapeId(parentItemId: string, childItemId: string): TLShapeId {
  return createShapeId(`derived-${parentItemId}-${childItemId}`);
}

// ---- 标注 StateNode 工具（模式搬自 cowart CowartAnnotationTool，简化：只画箭头+文字，固定标注色）----

class PetscapeAnnotationTool extends StateNode {
  static id = ANNOTATION_TOOL_ID;
  static initial = 'idle';
  static children() {
    return [PetscapeAnnotationIdle, PetscapeAnnotationPointing];
  }
}

class PetscapeAnnotationIdle extends StateNode {
  static id = 'idle';
  onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 });
  }
  onPointerDown(info: TLPointerEventInfo) {
    this.parent.transition('pointing', info);
  }
  onCancel() {
    this.editor.setCurrentTool('select');
  }
}

class PetscapeAnnotationPointing extends StateNode {
  static id = 'pointing';
  arrowId: TLShapeId | null = null;
  origin: { x: number; y: number } | null = null;
  markId = '';

  onEnter() {
    const origin = this.editor.inputs.getOriginPagePoint();
    const arrowId = createShapeId();
    this.arrowId = arrowId;
    this.origin = { x: origin.x, y: origin.y };
    this.markId = this.editor.markHistoryStoppingPoint(`creating_annotation:${arrowId}`);

    this.editor.createShape({
      id: arrowId,
      type: 'arrow',
      x: origin.x,
      y: origin.y,
      meta: { petscapeAnnotation: true },
      props: {
        dash: 'draw',
        size: 'm',
        fill: 'none',
        color: 'red',
        labelColor: 'red',
        bend: 0,
        start: { x: 0, y: 0 },
        end: { x: 1, y: 0 },
        arrowheadStart: 'none',
        arrowheadEnd: 'arrow',
        richText: toRichText(''),
        font: 'draw',
      },
    });
  }

  onPointerMove() {
    this.updateArrowEnd();
  }
  onPointerUp() {
    this.complete();
  }
  onCancel() {
    this.cancel();
  }
  onInterrupt() {
    this.cancel();
  }

  updateArrowEnd() {
    if (!this.arrowId || !this.origin) return;
    const point = this.editor.inputs.getCurrentPagePoint();
    this.editor.updateShapes([
      {
        id: this.arrowId,
        type: 'arrow',
        props: { end: { x: point.x - this.origin.x, y: point.y - this.origin.y } },
      },
    ]);
  }

  complete() {
    if (!this.arrowId || !this.origin) {
      this.editor.setCurrentTool(ANNOTATION_TOOL_ID);
      return;
    }
    this.updateArrowEnd();
    const point = this.editor.inputs.getCurrentPagePoint();
    const dx = point.x - this.origin.x;
    const dy = point.y - this.origin.y;
    const length = Math.hypot(dx, dy);

    if (length < ANNOTATION_MIN_LENGTH / this.editor.getZoomLevel()) {
      this.editor.bailToMark(this.markId);
      this.parent.transition('idle');
      return;
    }

    const arrowId = this.arrowId;
    this.editor.select(arrowId);
    startEditingShapeWithRichText(this.editor, arrowId, { selectAll: true });
    this.editor.getCurrentTool().setCurrentToolIdMask(ANNOTATION_TOOL_ID);
    this.parent.transition('idle');
  }

  cancel() {
    if (this.arrowId) this.editor.bailToMark(this.markId);
    this.parent.transition('idle');
  }
}

const petscapeTools = [PetscapeAnnotationTool];

const petscapeOverrides: TLUiOverrides = {
  translations: {
    en: { 'tool.petscape-annotation': ANNOTATION_TOOL_LABEL },
    'zh-cn': { 'tool.petscape-annotation': ANNOTATION_TOOL_LABEL },
  },
  tools(editor, tools) {
    return {
      ...tools,
      [ANNOTATION_TOOL_ID]: {
        id: ANNOTATION_TOOL_ID,
        label: 'tool.petscape-annotation',
        icon: 'tool-arrow',
        kbd: 'n',
        onSelect() {
          editor.setCurrentTool(ANNOTATION_TOOL_ID);
        },
      },
    };
  },
};

function PetscapeToolbar(props: DefaultToolbarProps) {
  const editor = useEditor();
  const isAnnotationSelected = useValue(
    'is annotation selected',
    () => editor.getCurrentToolId() === ANNOTATION_TOOL_ID,
    [editor],
  );
  return (
    <DefaultToolbar {...props}>
      <button
        aria-label={ANNOTATION_TOOL_LABEL}
        aria-pressed={isAnnotationSelected ? 'true' : 'false'}
        data-testid="tools.petscape-annotation"
        className="tlui-button tlui-button__tool"
        title={ANNOTATION_TOOL_LABEL}
        onClick={() => editor.setCurrentTool(ANNOTATION_TOOL_ID)}
      >
        <span style={{ fontSize: 15 }}>↗</span>
        <span style={{ fontSize: 10 }}>{ANNOTATION_TOOL_LABEL}</span>
      </button>
      <SelectToolbarItem />
      <HandToolbarItem />
      <DrawToolbarItem />
      <TextToolbarItem />
      <EraserToolbarItem />
    </DefaultToolbar>
  );
}

const petscapeComponents: TLComponents = {
  Toolbar: PetscapeToolbar,
};

// ---- 富文本 → 纯文本（tldraw richText 是 ProseMirror doc JSON，无官方导出的纯文本 helper）----
function richTextToPlain(richText: unknown): string {
  if (!richText || typeof richText !== 'object') return '';
  const node = richText as { text?: string; content?: unknown[] };
  if (typeof node.text === 'string') return node.text;
  if (Array.isArray(node.content)) {
    return node.content.map(richTextToPlain).filter(Boolean).join(' ');
  }
  return '';
}

// ---- 派生连线：从源卡到子卡画一条虚线（不依赖 snapshot，按 canvasItems.parentId 重建）----
function syncDerivedLinks(editor: Editor, items: CanvasItem[]) {
  for (const item of items) {
    if (!item.parentId) continue;
    const parent = items.find((it) => it.id === item.parentId);
    if (!parent) continue;
    const childShapeId = shapeIdForItem(item);
    const parentShapeId = shapeIdForItem(parent);
    const childShape = editor.getShape(childShapeId);
    const parentShape = editor.getShape(parentShapeId);
    if (!childShape || !parentShape) continue; // 两端卡片都落地后再连线

    const linkId = derivedLinkShapeId(parent.id, item.id);
    if (editor.getShape(linkId)) continue;

    const parentBounds = editor.getShapePageBounds(parentShapeId);
    const childBounds = editor.getShapePageBounds(childShapeId);
    if (!parentBounds || !childBounds) continue;

    // 按子卡相对父卡的方位（下方/右侧等）选最近的边中点连线，不假设固定横排布局。
    const goesBelow = childBounds.minY >= parentBounds.maxY - 1;
    const [startX, startY] = goesBelow
      ? [parentBounds.midX, parentBounds.maxY]
      : [parentBounds.maxX, parentBounds.midY];
    const [endX, endY] = goesBelow
      ? [childBounds.midX, childBounds.minY]
      : [childBounds.minX, childBounds.midY];

    editor.createShape<TLArrowShape>({
      id: linkId,
      type: 'arrow',
      x: startX,
      y: startY,
      meta: { petscapeDerivedLink: true, parentItemId: parent.id, childItemId: item.id },
      props: {
        dash: 'dashed',
        size: 's',
        color: 'grey',
        bend: 0,
        start: { x: 0, y: 0 },
        end: { x: endX - startX, y: endY - startY },
        arrowheadStart: 'none',
        arrowheadEnd: 'arrow',
      },
    });
  }
}

export interface WorkbenchCanvasProps {
  items: CanvasItem[];
  snapshot?: unknown;
  onSnapshotChange?: (snapshot: unknown) => void;
  onEditorReady?: (editor: Editor) => void;
  onSelectionChange?: (info: { itemId: string | null; kind: CanvasItem['kind'] | null; hasAnnotations: boolean }) => void;
}

export interface WorkbenchCanvasHandle {
  // 导出「选中场景 shape + 其上标注 shapes」的合成 PNG data URI + 拼接的标注文字。
  // 无标注（或场景卡不存在）时返回 null。
  exportAnnotatedScene(itemId: string): Promise<{ dataUri: string; note: string } | null>;
  // stepper 回退导航用的相机控制（供 page.tsx 在切换 viewState 时调用）。
  // 全部走 tldraw 公开 zoomToBounds/zoomToFit API，且调用方需保证已过首帧（避免 render 期改 store）。
  focusItemsOfKind(kind: CanvasItem['kind']): void; // 聚焦某类卡片的联合包围盒（步骤2：所有 scene2d）
  focusLatestItemOfKind(kind: CanvasItem['kind']): void; // 聚焦某类里最新一张卡（步骤3：最新 model3d）
  resetCamera(): void; // 复位到全部内容（步骤1）
}

const WorkbenchCanvas = forwardRef<WorkbenchCanvasHandle, WorkbenchCanvasProps>(function WorkbenchCanvas(
  { items, snapshot, onSnapshotChange, onEditorReady, onSelectionChange },
  ref,
) {
  const editorRef = useRef<Editor | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      onEditorReady?.(editor);

      // 1) 先 restore 布局快照（若有）——只恢复位置/相机，内容随后按 canvasItems 补齐。
      if (snapshot && typeof snapshot === 'object') {
        try {
          editor.store.mergeRemoteChanges(() => {
            editor.loadSnapshot(snapshot as Parameters<typeof editor.loadSnapshot>[0]);
          });
        } catch (e) {
          console.warn('[canvas] snapshot restore skipped:', e);
        }
      }

      // 2) 按当前 items 补建缺失卡片 + 派生连线（内容真相源重建）。
      // 用 rAF 推迟到 tldraw 首帧渲染之后再改 store，避免「渲染中更新别的组件」告警（cowart 同款）。
      editor.timers.requestAnimationFrame(() => {
        syncItemsToCanvas(editor, itemsRef.current);
        syncDerivedLinks(editor, itemsRef.current);
      });

      // 3) 布局变化去抖存回 server（视图层）
      const unlistenStore = editor.store.listen(
        () => {
          if (!onSnapshotChange) return;
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            onSnapshotChange(editor.getSnapshot());
          }, 600);
        },
        { source: 'user', scope: 'document' },
      );

      // 4) 选中场景卡时上报给外部（用于浮出「按标注修改」按钮）
      const unlistenSelection = editor.store.listen(
        () => {
          if (!onSelectionChange) return;
          const selected = editor.getSelectedShapes();
          const sceneShape = selected.find((s) => s.meta?.petscapeItemId) as TLImageShape | undefined;
          if (!sceneShape) {
            onSelectionChange({ itemId: null, kind: null, hasAnnotations: false });
            return;
          }
          const itemId = sceneShape.meta.petscapeItemId as string;
          const kind = (sceneShape.meta.petscapeKind as CanvasItem['kind'] | undefined) ?? 'scene2d';
          const hasAnnotations = findAnnotationsForScene(editor, sceneShape.id).length > 0;
          onSelectionChange({ itemId, kind, hasAnnotations });
        },
        { source: 'user', scope: 'session' },
      );

      return () => {
        if (saveTimer.current) clearTimeout(saveTimer.current);
        unlistenStore();
        unlistenSelection();
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // items 用 ref 传给 mount 后的首次 sync，避免 handleMount 依赖 items 反复 remount 编辑器
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // items 变化（轮询到新 ready 卡）时增量落画布 + 补连线。
  // 必须在 effect 里做——在 render 中改 tldraw store 会触发 React「渲染中更新别的组件」告警。
  useEffect(() => {
    if (!editorRef.current) return;
    syncItemsToCanvas(editorRef.current, items);
    syncDerivedLinks(editorRef.current, items);
  }, [items]);

  useImperativeHandle(
    ref,
    () => ({
      async exportAnnotatedScene(itemId: string) {
        const editor = editorRef.current;
        if (!editor) return null;
        const item = itemsRef.current.find((it) => it.id === itemId);
        if (!item) return null;
        const sceneShapeId = shapeIdForItem(item);
        const sceneShape = editor.getShape(sceneShapeId);
        if (!sceneShape) return null;

        const annotations = findAnnotationsForScene(editor, sceneShapeId);
        if (annotations.length === 0) return null;

        const note = annotations
          .map((a) => richTextToPlain((a.props as { richText?: unknown }).richText))
          .filter(Boolean)
          .join('；');
        if (!note) return null;

        const ids = [sceneShapeId, ...annotations.map((a) => a.id)];
        const { url } = await editor.toImageDataUrl(ids, { format: 'png', background: true, padding: 0 });
        return { dataUri: url, note };
      },
      focusItemsOfKind(kind: CanvasItem['kind']) {
        const editor = editorRef.current;
        if (!editor) return;
        const matching = itemsRef.current.filter((it) => it.kind === kind && it.status !== 'failed');
        const shapeIds = matching.map((it) => shapeIdForItem(it)).filter((id) => editor.getShape(id));
        if (shapeIds.length === 0) {
          editor.zoomToFit({ animation: { duration: 300 } });
          return;
        }
        const bounds = shapeIds.reduce<Box | null>((acc, id) => {
          const b = editor.getShapePageBounds(id);
          if (!b) return acc;
          return acc ? Box.Expand(acc, b) : b.clone();
        }, null);
        if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 300 }, inset: 80 });
      },
      focusLatestItemOfKind(kind: CanvasItem['kind']) {
        const editor = editorRef.current;
        if (!editor) return;
        const matching = itemsRef.current.filter((it) => it.kind === kind && it.status === 'ready');
        const latest = matching[matching.length - 1];
        if (!latest) {
          editor.zoomToFit({ animation: { duration: 300 } });
          return;
        }
        const shapeId = shapeIdForItem(latest);
        const bounds = editor.getShapePageBounds(shapeId);
        if (bounds) {
          editor.zoomToBounds(bounds, { animation: { duration: 300 }, inset: 80 });
        } else {
          editor.zoomToFit({ animation: { duration: 300 } });
        }
      },
      resetCamera() {
        const editor = editorRef.current;
        if (!editor) return;
        editor.zoomToFit({ animation: { duration: 300 } });
      },
    }),
    [],
  );

  return (
    <div className="tldraw__editor h-full w-full">
      <Tldraw
        onMount={handleMount}
        tools={petscapeTools}
        overrides={petscapeOverrides}
        components={petscapeComponents}
      />
    </div>
  );
});

export default WorkbenchCanvas;

// 候选卡片位置 (x,y) 是否与画布上任何已有场景/派生 image shape 重叠（新卡落地避让用）。
function overlapsAnyShape(editor: Editor, x: number, y: number): boolean {
  const candidate = new Box(x, y, CARD_W, CARD_H);
  return editor
    .getCurrentPageShapes()
    .filter((s) => s.type === 'image')
    .some((s) => {
      const b = editor.getShapePageBounds(s.id);
      return b ? Box.Collides(candidate, b) : false;
    });
}

// 找出与某个场景 image shape 页面包围盒重叠（视为"标注在这张图上"）的标注箭头。
function findAnnotationsForScene(editor: Editor, sceneShapeId: TLShapeId) {
  const sceneBounds = editor.getShapePageBounds(sceneShapeId);
  if (!sceneBounds) return [];
  // 标注箭头常有超出图片边界的文字标签，放宽一点判定边界（padding）。
  const generousBounds = sceneBounds.clone().expandBy(40);

  return editor
    .getCurrentPageShapes()
    .filter((s) => s.type === 'arrow' && s.meta?.petscapeAnnotation === true)
    .filter((s) => {
      const b = editor.getShapePageBounds(s.id);
      return b ? Box.Collides(generousBounds, b) : false;
    }) as TLArrowShape[];
}

// 把 ready 的 canvasItems 增量同步到画布：
//  - scene2d / item2d：缺 shape 则建 image asset + image shape（白底物品图与场景图同为 image 卡）。
//  - model3d：GLB 无法作 tldraw image，建一张占位缩略卡（真正可旋转的 model-viewer 由 page.tsx 覆盖层渲染）。
function syncItemsToCanvas(editor: Editor, items: CanvasItem[]) {
  const ready = items.filter(
    (it) => it.status === 'ready' && (it.imagePath || (it.kind === 'model3d' && it.glbPath)),
  );
  ready.forEach((item, index) => {
    const shapeId = shapeIdForItem(item);
    if (editor.getShape(shapeId)) return; // 已在画布

    // model3d 卡：无 2D 图，落一张占位缩略图卡（提示「3D 模型」）；实时预览在覆盖层。
    if (item.kind === 'model3d') {
      placeModel3dCard(editor, item, items);
      return;
    }

    const assetId = assetIdForItem(item);
    if (!editor.getAsset(assetId)) {
      editor.createAssets([
        {
          id: assetId,
          type: 'image',
          typeName: 'asset',
          props: {
            name: item.name,
            src: item.imagePath!,
            w: 1024,
            h: 1024,
            mimeType: 'image/png',
            isAnimated: false,
          },
          meta: {},
        },
      ]);
    }

    const { x, y } = placementFor(editor, item, items, index);
    editor.createShape({
      id: shapeId,
      type: 'image',
      x,
      y,
      meta: { petscapeItemId: item.id, petscapeName: item.name, petscapeKind: item.kind },
      props: { assetId, w: CARD_W, h: CARD_H },
    });
  });
}

// 卡片落点：有 parentId 则落父卡正下方新的一行（碰撞兜底继续下移），否则按横排。派生卡与 image 卡共用。
function placementFor(editor: Editor, item: CanvasItem, items: CanvasItem[], index: number) {
  const parent = item.parentId ? items.find((it) => it.id === item.parentId) : undefined;
  const parentShape = parent ? editor.getShape(shapeIdForItem(parent)) : undefined;
  if (parentShape) {
    const x = parentShape.x;
    let y = parentShape.y + CARD_H + GAP_X;
    while (overlapsAnyShape(editor, x, y)) y += CARD_H + GAP_X;
    return { x, y };
  }
  return { x: START_X + index * (CARD_W + GAP_X), y: START_Y };
}

// model3d 占位卡：GLB 不能作 tldraw image，落一张 model3d-preview 缩略图 + meta 标记，供覆盖层定位与选中。
function placeModel3dCard(editor: Editor, item: CanvasItem, items: CanvasItem[]) {
  const shapeId = shapeIdForItem(item);
  const assetId = assetIdForItem(item);
  if (!editor.getAsset(assetId)) {
    editor.createAssets([
      {
        id: assetId,
        type: 'image',
        typeName: 'asset',
        props: { name: item.name, src: '/mockup-assets/model3d-preview.jpg', w: 1024, h: 1024, mimeType: 'image/jpeg', isAnimated: false },
        meta: {},
      },
    ]);
  }
  const { x, y } = placementFor(editor, item, items, 0);
  editor.createShape({
    id: shapeId,
    type: 'image',
    x,
    y,
    meta: { petscapeItemId: item.id, petscapeName: item.name, petscapeKind: 'model3d' },
    props: { assetId, w: CARD_W, h: CARD_H },
  });
}
