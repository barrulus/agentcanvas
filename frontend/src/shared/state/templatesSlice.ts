import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'

export interface TemplateField {
  name: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'number'
  placeholder?: string | null
  default?: string | null
  options?: string[] | null
  required: boolean
}

export interface PromptTemplate {
  id: string
  name: string
  slug: string
  description?: string | null
  prompt: string
  fields: TemplateField[]
  provider_id?: string | null
  model?: string | null
  system_prompt?: string | null
  is_builtin?: boolean
  tags: string[]
  created_at: number
  updated_at: number
}

interface TemplatesState {
  templates: PromptTemplate[]
  loading: boolean
}

const initialState: TemplatesState = {
  templates: [],
  loading: false,
}

export const fetchTemplates = createAsyncThunk('templates/fetchTemplates', async () => {
  const res = await fetch('/api/templates')
  const data = await res.json()
  return data.templates as PromptTemplate[]
})

export const createTemplate = createAsyncThunk('templates/createTemplate', async (template: Partial<PromptTemplate>) => {
  const res = await fetch('/api/templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(template),
  })
  return await res.json() as PromptTemplate
})

export const updateTemplate = createAsyncThunk('templates/updateTemplate', async ({ id, ...updates }: Partial<PromptTemplate> & { id: string }) => {
  const res = await fetch(`/api/templates/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })
  return await res.json() as PromptTemplate
})

export const deleteTemplate = createAsyncThunk('templates/deleteTemplate', async (templateId: string) => {
  await fetch(`/api/templates/${templateId}`, { method: 'DELETE' })
  return templateId
})

const templatesSlice = createSlice({
  name: 'templates',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(fetchTemplates.pending, (state) => { state.loading = true })
    builder.addCase(fetchTemplates.fulfilled, (state, action) => {
      state.templates = action.payload
      state.loading = false
    })
    builder.addCase(createTemplate.fulfilled, (state, action) => {
      state.templates.push(action.payload)
    })
    builder.addCase(updateTemplate.fulfilled, (state, action) => {
      const idx = state.templates.findIndex(t => t.id === action.payload.id)
      if (idx >= 0) state.templates[idx] = action.payload
    })
    builder.addCase(deleteTemplate.fulfilled, (state, action) => {
      state.templates = state.templates.filter(t => t.id !== action.payload)
    })
  },
})

export const templatesReducer = templatesSlice.reducer
