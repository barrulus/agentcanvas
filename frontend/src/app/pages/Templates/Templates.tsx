import { useState, useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { RootState, AppDispatch } from '@/shared/state/store'
import { fetchTemplates, createTemplate, deleteTemplate, PromptTemplate } from '@/shared/state/templatesSlice'

export function Templates({ onClose, onUseTemplate }: {
  onClose: () => void
  onUseTemplate?: (template: PromptTemplate) => void
}) {
  const dispatch = useDispatch<AppDispatch>()
  const templates = useSelector((s: RootState) => s.templates.templates)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    name: '', slug: '', description: '', prompt: '', tags: '',
    fields: [] as Array<{ name: string; label: string; type: string; placeholder: string; required: boolean }>,
  })

  useEffect(() => { dispatch(fetchTemplates()) }, [dispatch])

  const handleCreate = () => {
    if (!formData.name || !formData.slug || !formData.prompt) return
    dispatch(createTemplate({
      name: formData.name,
      slug: formData.slug,
      description: formData.description || undefined,
      prompt: formData.prompt,
      tags: formData.tags ? formData.tags.split(',').map(t => t.trim()) : [],
      fields: formData.fields.map(f => ({ ...f, type: f.type as any })),
    }))
    setShowForm(false)
    setFormData({ name: '', slug: '', description: '', prompt: '', tags: '', fields: [] })
  }

  const addField = () => {
    setFormData(d => ({
      ...d,
      fields: [...d.fields, { name: '', label: '', type: 'text', placeholder: '', required: true }],
    }))
  }

  const updateField = (idx: number, key: string, value: any) => {
    setFormData(d => ({
      ...d,
      fields: d.fields.map((f, i) => i === idx ? { ...f, [key]: value } : f),
    }))
  }

  const removeField = (idx: number) => {
    setFormData(d => ({ ...d, fields: d.fields.filter((_, i) => i !== idx) }))
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{
        position: 'relative', width: 450, height: '100%', background: '#12121e',
        borderLeft: '1px solid #333', display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid #222', flexShrink: 0,
        }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: '#e0e0e0' }}>Templates</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setShowForm(!showForm)} style={{
              padding: '4px 10px', background: '#4fc3f7', color: '#000', border: 'none',
              borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}>+ New</button>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', color: '#888', fontSize: 20, cursor: 'pointer', lineHeight: 1,
            }}>&times;</button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
          {showForm && (
            <div style={{
              background: '#1a1a2e', borderRadius: 8, border: '1px solid #333',
              padding: 16, marginBottom: 12,
            }}>
              <h4 style={{ margin: '0 0 12px', color: '#ccc', fontSize: 13 }}>New Template</h4>
              <input placeholder="Name" value={formData.name} onChange={e => setFormData(d => ({ ...d, name: e.target.value }))}
                style={inputStyle} />
              <input placeholder="Slug (e.g., code-review)" value={formData.slug}
                onChange={e => setFormData(d => ({ ...d, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                style={inputStyle} />
              <input placeholder="Description" value={formData.description}
                onChange={e => setFormData(d => ({ ...d, description: e.target.value }))} style={inputStyle} />
              <textarea placeholder="Prompt template (use {{field_name}} for placeholders)" value={formData.prompt}
                onChange={e => setFormData(d => ({ ...d, prompt: e.target.value }))}
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} />
              <input placeholder="Tags (comma-separated)" value={formData.tags}
                onChange={e => setFormData(d => ({ ...d, tags: e.target.value }))} style={inputStyle} />

              {formData.fields.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: '#888' }}>Fields:</span>
                  {formData.fields.map((f, i) => (
                    <div key={i} style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                      <input placeholder="name" value={f.name} onChange={e => updateField(i, 'name', e.target.value)}
                        style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
                      <input placeholder="label" value={f.label} onChange={e => updateField(i, 'label', e.target.value)}
                        style={{ ...inputStyle, flex: 1, marginBottom: 0 }} />
                      <select value={f.type} onChange={e => updateField(i, 'type', e.target.value)}
                        style={{ ...inputStyle, width: 80, marginBottom: 0 }}>
                        <option value="text">text</option>
                        <option value="textarea">textarea</option>
                        <option value="number">number</option>
                        <option value="select">select</option>
                      </select>
                      <button onClick={() => removeField(i)} style={{
                        background: 'none', border: 'none', color: '#ef5350', cursor: 'pointer', fontSize: 14,
                      }}>&times;</button>
                    </div>
                  ))}
                </div>
              )}
              <button onClick={addField} style={{
                background: 'none', border: '1px solid #333', color: '#888', fontSize: 11,
                padding: '2px 8px', borderRadius: 4, cursor: 'pointer', marginBottom: 8,
              }}>+ Add Field</button>

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setShowForm(false)} style={{
                  padding: '6px 12px', background: 'transparent', color: '#888',
                  border: '1px solid #333', borderRadius: 4, cursor: 'pointer', fontSize: 12,
                }}>Cancel</button>
                <button onClick={handleCreate} style={{
                  padding: '6px 12px', background: '#4fc3f7', color: '#000',
                  border: 'none', borderRadius: 4, fontWeight: 600, cursor: 'pointer', fontSize: 12,
                }}>Create</button>
              </div>
            </div>
          )}

          {templates.length === 0 && !showForm && (
            <div style={{ color: '#555', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
              No templates yet. Click "+ New" to create one.
            </div>
          )}

          {templates.map(t => (
            <div key={t.id} style={{
              background: '#1a1a2e', borderRadius: 8, border: '1px solid #2a2a3e',
              padding: '10px 12px', marginBottom: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#ccc', flex: 1 }}>{t.name}</span>
                <span style={{ fontSize: 10, color: '#4fc3f7', background: '#1a2a3e', padding: '1px 6px', borderRadius: 3 }}>
                  /{t.slug}
                </span>
              </div>
              {t.description && <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{t.description}</div>}
              {t.tags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  {t.tags.map(tag => (
                    <span key={tag} style={{ fontSize: 9, color: '#666', background: '#222', padding: '1px 4px', borderRadius: 2 }}>{tag}</span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                {onUseTemplate && (
                  <button onClick={() => onUseTemplate(t)} style={{
                    padding: '3px 10px', background: '#1a6fb5', color: '#e0e0e0', border: 'none',
                    borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  }}>Use</button>
                )}
                <button onClick={() => dispatch(deleteTemplate(t.id))} style={{
                  padding: '3px 10px', background: 'transparent', color: '#ef5350',
                  border: '1px solid #ef535033', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', marginBottom: 8,
  background: '#12121e', color: '#e0e0e0', border: '1px solid #333',
  borderRadius: 4, fontSize: 12, fontFamily: 'inherit', boxSizing: 'border-box',
}
