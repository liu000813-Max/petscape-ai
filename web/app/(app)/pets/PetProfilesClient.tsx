'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { PetResponse } from '@petscape/server/contracts/pets';

const SPECIES = [
  ['rat', '鼠类'],
  ['gecko', '守宫'],
  ['snake', '蛇'],
  ['parrot', '鹦鹉'],
  ['spider', '蜘蛛'],
  ['other', '其他'],
] as const;

const LIFE_STAGES = [
  ['juvenile', '幼年'],
  ['adult', '成年'],
  ['senior', '老年'],
  ['unknown', '不确定'],
] as const;

const TRAITS = ['亲人', '胆小', '好奇', '活跃', '安静', '领地意识'] as const;

type PetForm = {
  name: string;
  speciesCode: NonNullable<PetResponse['speciesCode']> | '';
  customSpeciesName: string;
  breed: string;
  sizeLevel: string;
  lifeStage: NonNullable<PetResponse['lifeStage']> | '';
  behaviorTraits: string[];
  environmentNotes: string;
  specialNeeds: string;
};

const emptyForm: PetForm = {
  name: '',
  speciesCode: '',
  customSpeciesName: '',
  breed: '',
  sizeLevel: '',
  lifeStage: '',
  behaviorTraits: [],
  environmentNotes: '',
  specialNeeds: '',
};

class PetApiClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PetApiClientError';
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : null;
    const issue = Array.isArray(data?.issues) && typeof data.issues[0]?.message === 'string'
      ? data.issues[0].message
      : null;
    throw new PetApiClientError(detail ?? issue ?? `请求失败（${response.status}）`);
  }
  return data as T;
}

function formFromPet(pet: PetResponse): PetForm {
  return {
    name: pet.name,
    speciesCode: pet.speciesCode ?? '',
    customSpeciesName: pet.customSpeciesName ?? '',
    breed: pet.breed ?? '',
    sizeLevel: pet.sizeLevel?.toString() ?? '',
    lifeStage: pet.lifeStage ?? '',
    behaviorTraits: pet.behaviorTraits,
    environmentNotes: pet.environmentNotes ?? '',
    specialNeeds: pet.specialNeeds ?? '',
  };
}

function requestBody(form: PetForm) {
  return {
    name: form.name,
    speciesCode: form.speciesCode || null,
    customSpeciesName: form.speciesCode === 'other' ? form.customSpeciesName || null : null,
    breed: form.breed || null,
    sizeLevel: form.sizeLevel ? Number(form.sizeLevel) : null,
    lifeStage: form.lifeStage || null,
    behaviorTraits: form.behaviorTraits,
    environmentNotes: form.environmentNotes || null,
    specialNeeds: form.specialNeeds || null,
  };
}

function petSubtitle(pet: PetResponse) {
  const species = pet.speciesCode === 'other'
    ? pet.customSpeciesName
    : SPECIES.find(([code]) => code === pet.speciesCode)?.[1];
  return [species, pet.breed, pet.sizeLevel ? `${pet.sizeLevel} 级体型` : null].filter(Boolean).join(' · ') || '等待补充设计资料';
}

export function PetProfilesClient() {
  const [pets, setPets] = useState<PetResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPet, setEditingPet] = useState<PetResponse | null>(null);
  const [form, setForm] = useState<PetForm>(emptyForm);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function loadPets() {
    const result = await api<{ pets: PetResponse[] }>('/api/v1/pets');
    setPets(result.pets);
  }

  useEffect(() => {
    let active = true;
    api<{ pets: PetResponse[] }>('/api/v1/pets')
      .then((result) => {
        if (active) setPets(result.pets);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught instanceof Error ? caught.message : '档案加载失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (coverPreview?.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  const title = useMemo(() => (editingPet ? `编辑 ${editingPet.name}` : '新建宠物档案'), [editingPet]);

  function openCreate() {
    setEditingPet(null);
    setForm(emptyForm);
    setCoverFile(null);
    setCoverPreview(null);
    setError(null);
    setEditorOpen(true);
  }

  function openEdit(pet: PetResponse) {
    setEditingPet(pet);
    setForm(formFromPet(pet));
    setCoverFile(null);
    setCoverPreview(pet.coverUrl);
    setError(null);
    setEditorOpen(true);
  }

  function closeEditor() {
    if (saving) return;
    setEditorOpen(false);
    setCoverFile(null);
    setCoverPreview(null);
  }

  function chooseCover(file: File | undefined) {
    if (!file) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  }

  function toggleTrait(trait: string) {
    setForm((current) => ({
      ...current,
      behaviorTraits: current.behaviorTraits.includes(trait)
        ? current.behaviorTraits.filter((item) => item !== trait)
        : [...current.behaviorTraits, trait],
    }));
  }

  async function uploadCover(petId: string, file: File) {
    const requested = await api<{ assetId: string; uploadUrl: string }>(
      `/api/v1/pets/${petId}/cover-upload`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mime: file.type, size: file.size }),
      },
    );
    // ali-oss V4 URL 当前没有把 Content-Type 纳入签名。浏览器直接发送 File 会自动
    // 附带该 header，导致 OSS 以不同 canonical headers 重算后 403；ArrayBuffer
    // 不会自动注入 Content-Type，与服务端签名时的 headers 保持一致。
    const uploaded = await fetch(requested.uploadUrl, {
      method: 'PUT',
      body: await file.arrayBuffer(),
    });
    if (!uploaded.ok) throw new PetApiClientError(`封面上传失败（${uploaded.status}）`);
    await api(`/api/v1/assets/${requested.assetId}/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ size: file.size }),
    });
    await api(`/api/v1/pets/${petId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ coverAssetId: requested.assetId }),
    });
  }

  async function savePet(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const pet = editingPet
        ? await api<PetResponse>(`/api/v1/pets/${editingPet.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(requestBody(form)),
          })
        : await api<PetResponse>('/api/v1/pets', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(requestBody(form)),
          });

      // 创建本体成功但后续 OSS 上传失败时，把编辑器切到该 Pet；用户再次保存会 PATCH
      // 原记录并重试封面，不会因一次网络/CORS 故障重复创建同名档案。
      if (!editingPet) setEditingPet(pet);
      if (coverFile) await uploadCover(pet.id, coverFile);
      await loadPets();
      setEditorOpen(false);
      setCoverFile(null);
      setCoverPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  }

  async function removePet(pet: PetResponse) {
    if (!window.confirm(`删除「${pet.name}」？档案会从列表隐藏，照片仍保留在你的资产中。`)) return;
    setError(null);
    try {
      await api(`/api/v1/pets/${pet.id}`, { method: 'DELETE' });
      await loadPets();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除失败');
    }
  }

  return (
    <div className="psx-page psx-pets-page psx-fade-up">
      <div className="psx-pets-heading">
        <div>
          <span className="psx-dot-label">长期设计档案</span>
          <h1 className="psx-page-title">宠物档案</h1>
          <p>先记录稳定的宠物信息。创建项目时再补充当次环境尺寸与参考照片。</p>
        </div>
        <button className="psx-btn-ghost psx-pets-create" type="button" onClick={openCreate}>
          <Plus size={17} /> 新建档案
        </button>
      </div>

      {error && !editorOpen ? <div className="psx-pets-alert" role="alert">{error}</div> : null}

      {loading ? (
        <div className="psx-pets-empty">正在读取你的宠物档案…</div>
      ) : pets.length === 0 ? (
        <section className="psx-pets-empty psx-pets-empty-first">
          <span className="psx-circle"><Plus size={18} /></span>
          <h2>从第一只宠物开始</h2>
          <p>名称是唯一必填项，其他资料可以随时补充。</p>
          <button className="psx-btn-primary" type="button" onClick={openCreate}>创建宠物档案</button>
        </section>
      ) : (
        <section className="psx-pet-grid" aria-label="宠物档案列表">
          {pets.map((pet) => (
            <article className="psx-pet-card" key={pet.id}>
              <div className="psx-pet-cover">
                {pet.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 私有 OSS 短签名 URL，无法由 Next image optimizer 稳定缓存
                  <img src={pet.coverUrl} alt={`${pet.name} 的封面`} />
                ) : (
                  <div className="psx-pet-cover-empty"><Camera size={22} /><span>等待封面</span></div>
                )}
              </div>
              <div className="psx-pet-card-body">
                <div>
                  <h2>{pet.name}</h2>
                  <p>{petSubtitle(pet)}</p>
                </div>
                {pet.behaviorTraits.length > 0 ? (
                  <div className="psx-pet-tags">{pet.behaviorTraits.slice(0, 3).map((trait) => <span key={trait}>{trait}</span>)}</div>
                ) : null}
                <div className="psx-pet-actions">
                  <button type="button" onClick={() => openEdit(pet)}><Pencil size={14} /> 编辑</button>
                  <button type="button" className="is-danger" onClick={() => removePet(pet)}><Trash2 size={14} /> 删除</button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {editorOpen ? (
        <div className="psx-pet-editor-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeEditor();
        }}>
          <section className="psx-pet-editor" role="dialog" aria-modal="true" aria-labelledby="pet-editor-title">
            <header>
              <div><span className="psx-dot-label">Pet Profile</span><h2 id="pet-editor-title">{title}</h2></div>
              <button type="button" className="psx-pet-editor-close" onClick={closeEditor} aria-label="关闭编辑器"><X size={19} /></button>
            </header>

            <form onSubmit={savePet}>
              <button className="psx-cover-picker" type="button" onClick={() => fileInputRef.current?.click()}>
                {coverPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- 本地 blob 或私有 OSS 预览
                  <img src={coverPreview} alt="宠物封面预览" />
                ) : <span><Camera size={22} />添加一张封面照片</span>}
              </button>
              <input
                ref={fileInputRef}
                className="psx-visually-hidden"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => chooseCover(event.target.files?.[0])}
                aria-label="选择封面照片"
              />

              <div className="psx-pet-form-grid">
                <label className="is-wide"><span>名称 *</span><input required maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：小椒" /></label>
                <label><span>物种</span><select value={form.speciesCode} onChange={(event) => setForm({ ...form, speciesCode: event.target.value as PetForm['speciesCode'] })}><option value="">稍后补充</option>{SPECIES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                {form.speciesCode === 'other' ? <label><span>自定义物种 *</span><input required maxLength={120} value={form.customSpeciesName} onChange={(event) => setForm({ ...form, customSpeciesName: event.target.value })} /></label> : null}
                <label><span>品种</span><input maxLength={120} value={form.breed} onChange={(event) => setForm({ ...form, breed: event.target.value })} placeholder="可选" /></label>
                <label><span>体型等级</span><select value={form.sizeLevel} onChange={(event) => setForm({ ...form, sizeLevel: event.target.value })}><option value="">稍后补充</option>{[1, 2, 3, 4, 5].map((value) => <option value={value} key={value}>{value} 级</option>)}</select></label>
                <label><span>生命阶段</span><select value={form.lifeStage} onChange={(event) => setForm({ ...form, lifeStage: event.target.value as PetForm['lifeStage'] })}><option value="">稍后补充</option>{LIFE_STAGES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              </div>

              <fieldset className="psx-trait-fieldset"><legend>行为标签</legend><div>{TRAITS.map((trait) => <button type="button" key={trait} aria-pressed={form.behaviorTraits.includes(trait)} onClick={() => toggleTrait(trait)}>{trait}</button>)}</div></fieldset>

              <label className="psx-textarea-field"><span>环境备注</span><textarea maxLength={2000} value={form.environmentNotes} onChange={(event) => setForm({ ...form, environmentNotes: event.target.value })} placeholder="例如：偏好攀爬、需要遮蔽空间" /></label>
              <label className="psx-textarea-field"><span>特殊需求</span><textarea maxLength={2000} value={form.specialNeeds} onChange={(event) => setForm({ ...form, specialNeeds: event.target.value })} placeholder="仅记录会影响后续设计的长期信息" /></label>

              {error ? <div className="psx-pets-alert" role="alert">{error}</div> : null}
              <footer><button type="button" className="psx-btn-ghost" onClick={closeEditor}>取消</button><button type="submit" className="psx-btn-primary" disabled={saving}>{saving ? '正在保存…' : '保存档案'}</button></footer>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
