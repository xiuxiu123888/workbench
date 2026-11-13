import { ref } from 'vue'
import type { GenerationRecord } from './domain/generationLog'

export const generationRecords = ref<GenerationRecord[]>([])
export const generationLogOpen = ref(false)
