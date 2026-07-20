'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Pencil, Plus, Trash2 } from 'lucide-react';
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
  const [editingPet, setEditingPet] = useState<PetResponse | null>(null);
  const [form, setForm] = useState<PetForm>(emptyForm);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
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

  useEffect(() => () => {
    if (coverPreview?.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
  }, [coverPreview]);

  function openCreate() {
    setEditingPet(null);
    setForm({ ...emptyForm });
    setCoverFile(null);
    setCoverPreview(null);
    setError(null);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function openEdit(pet: PetResponse) {
    setEditingPet(pet);
    setForm(formFromPet(pet));
    setCoverFile(null);
    setCoverPreview(pet.coverUrl);
    setError(null);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function closeEditor() {
    if (saving) return;
    setShowForm(false);
    setCoverFile(null);
    setCoverPreview(null);
    setError(null);
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

      if (!editingPet) setEditingPet(pet);
      if (coverFile) await uploadCover(pet.id, coverFile);
      await loadPets();
      setShowForm(false);
      setEditingPet(null);
      setCoverFile(null);
      setCoverPreview(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  }

  async function removePet(pet: PetResponse) {
    if (!window.confirm(`删除“${pet.name}”？此操作不可撤销。`)) return;
    setError(null);
    try {
      await api(`/api/v1/pets/${pet.id}`, { method: 'DELETE' });
      await loadPets();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除失败');
    }
  }

  if (showForm) {
    return (
      <div className="psx-page psx-pets-page psx-pet-form-page psx-fade-up">
        <form className="psx-pet-page-form" onSubmit={savePet}>
          <aside className="psx-pet-form-intro">
            <div>
              <span className="psx-dot-label">长期设计档案</span>
              <h1 className="psx-page-title">{editingPet ? `编辑 ${editingPet.name}` : '新建宠物档案'}</h1>
            </div>
            <p>只记录长期稳定的信息。创建项目时，再补充当次的环境尺寸与参考照片。</p>
            <button className="psx-pet-cover-picker" type="button" onClick={() => fileInputRef.current?.click()}>
              {coverPreview ? (
                // eslint-disable-next-line @next/next/no-img-element -- 本地 blob 或私有 OSS 预览
                <img src={coverPreview} alt="宠物封面预览" />
              ) : <span className="psx-pet-cover-icon"><Camera size={19} /></span>}
              <span><strong>{coverPreview ? '更换封面照片' : '添加一张封面照片'}</strong><small>选填 · JPG / PNG / WEBP · 之后随时可换</small></span>
            </button>
            <input ref={fileInputRef} className="psx-visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => chooseCover(event.target.files?.[0])} aria-label="选择封面照片" />
            <p className="psx-pet-form-note">名称是唯一必填项，其他资料都可以随时回来补。</p>
          </aside>

          <div className="psx-pet-form-fields">
            <section className="psx-pet-field-group">
              <span className="psx-pet-group-label">基 本 信 息</span>
              <label className="psx-pet-field"><span>名称 *</span><input required maxLength={80} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如：小椒" /></label>
              <div className="psx-pet-chip-field"><span>物种</span><div className="psx-pet-chips">
                {SPECIES.map(([value, label]) => <button type="button" key={value} aria-pressed={form.speciesCode === value} onClick={() => setForm({ ...form, speciesCode: form.speciesCode === value ? '' : value })}>{label}</button>)}
              </div></div>
              {form.speciesCode === 'other' ? <label className="psx-pet-field"><span>自定义物种 *</span><input required maxLength={120} value={form.customSpeciesName} onChange={(event) => setForm({ ...form, customSpeciesName: event.target.value })} placeholder="例如：刺猬" /></label> : null}
              <label className="psx-pet-field is-half"><span>品种 <small>选填</small></span><input maxLength={120} value={form.breed} onChange={(event) => setForm({ ...form, breed: event.target.value })} placeholder="例如：花枝鼠" /></label>
            </section>

            <section className="psx-pet-field-group">
              <span className="psx-pet-group-label">体 型 与 阶 段</span>
              <div className="psx-pet-chip-field"><span>体型等级 <small>从迷你到大型的粗略分级</small></span><div className="psx-pet-chips">
                {[1, 2, 3, 4, 5].map((value) => <button type="button" key={value} aria-pressed={form.sizeLevel === String(value)} onClick={() => setForm({ ...form, sizeLevel: form.sizeLevel === String(value) ? '' : String(value) })}>{value} 级</button>)}
              </div></div>
              <div className="psx-pet-chip-field"><span>生命阶段</span><div className="psx-pet-chips">
                {LIFE_STAGES.map(([value, label]) => <button type="button" key={value} aria-pressed={form.lifeStage === value} onClick={() => setForm({ ...form, lifeStage: form.lifeStage === value ? '' : value })}>{label}</button>)}
              </div></div>
            </section>

            <section className="psx-pet-field-group">
              <span className="psx-pet-group-label">行 为 标 签</span>
              <p className="psx-pet-group-hint">多选。这些标签会影响后续设计建议，比如胆小的宠物会优先考虑遮蔽结构。</p>
              <div className="psx-pet-chips">{TRAITS.map((trait) => <button type="button" key={trait} aria-pressed={form.behaviorTraits.includes(trait)} onClick={() => toggleTrait(trait)}>{trait}</button>)}</div>
            </section>

            <section className="psx-pet-field-group">
              <span className="psx-pet-group-label">备 注</span>
              <label className="psx-pet-field"><span>环境备注 <small>选填</small></span><textarea maxLength={2000} rows={3} value={form.environmentNotes} onChange={(event) => setForm({ ...form, environmentNotes: event.target.value })} placeholder="例如：偏好攀爬、需要遮蔽空间" /></label>
              <label className="psx-pet-field"><span>特殊需求 <small>选填</small></span><textarea maxLength={2000} rows={3} value={form.specialNeeds} onChange={(event) => setForm({ ...form, specialNeeds: event.target.value })} placeholder="仅记录会影响后续设计的长期信息" /></label>
            </section>
          </div>

          <div className="psx-pet-sticky-actions">
            <span>带 * 的是必填项 · 其余随时可补</span>
            <div><button type="button" className="psx-btn-ghost" onClick={closeEditor}>取消</button><button type="submit" className="psx-btn-primary" disabled={saving}>{saving ? '正在保存…' : '保存档案'}</button></div>
          </div>
          {error ? <div className="psx-pets-alert psx-pet-form-error" role="alert">{error}</div> : null}
        </form>
      </div>
    );
  }

  return (
    <div className="psx-page psx-pets-page psx-fade-up">
      <header className="psx-pets-heading">
        <div><span className="psx-dot-label">长期设计档案</span><h1 className="psx-page-title">宠物档案</h1><p>保存长期稳定的信息，让每次定制都从熟悉你的宠物开始。</p></div>
        <button type="button" className="psx-btn-primary psx-pets-create" onClick={openCreate}><Plus size={17} />新建宠物档案</button>
      </header>
      {error ? <div className="psx-pets-alert" role="alert">{error}</div> : null}
      {loading ? <div className="psx-pets-empty">正在读取宠物档案…</div> : pets.length === 0 ? (
        <section className="psx-pets-empty-first"><span className="psx-dot-label">从第一只宠物开始</span><h2>还没有宠物档案</h2><p>先记录名称和几项长期信息。每次定制都会从这里出发。</p><button type="button" className="psx-btn-primary" onClick={openCreate}><Plus size={17} />新建宠物档案</button></section>
      ) : (
        <section className="psx-pet-grid" aria-label="宠物档案列表">
          {pets.map((pet) => <article className="psx-pet-card" key={pet.id}>
            <div className="psx-pet-cover">{pet.coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- 私有 OSS 签名 URL
              <img src={pet.coverUrl} alt={`${pet.name} 的封面`} />
            ) : <div className="psx-pet-cover-empty">{pet.name.slice(0, 1)}</div>}</div>
            <div className="psx-pet-card-body"><div><h2>{pet.name}</h2><p>{petSubtitle(pet)}</p></div>
              {pet.behaviorTraits.length > 0 ? <div className="psx-pet-tags">{pet.behaviorTraits.slice(0, 3).map((trait) => <span key={trait}>{trait}</span>)}</div> : null}
              <div className="psx-pet-actions"><button type="button" onClick={() => openEdit(pet)}><Pencil size={14} />编辑</button><button type="button" className="is-danger" onClick={() => removePet(pet)}><Trash2 size={14} />删除</button></div>
            </div>
          </article>)}
          <button className="psx-pet-new-tail" type="button" onClick={openCreate}><span><Plus size={20} /></span><strong>新建宠物档案</strong><small>为另一只宠物保存长期信息</small></button>
        </section>
      )}
    </div>
  );
}
