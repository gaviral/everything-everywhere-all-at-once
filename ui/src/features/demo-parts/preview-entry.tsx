import { createRoot } from 'react-dom/client'
import { SyntheticPreview } from './SyntheticPreview'
import { createSyntheticAdapter } from './synthetic'

const preview = createSyntheticAdapter()
createRoot(document.getElementById('root')!).render(<SyntheticPreview adapter={preview.adapter} />)
