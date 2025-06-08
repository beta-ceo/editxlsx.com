import 'ranui/loading'

export const showLoading = () => {
    const loading = document.createElement('r-loading')
    loading.setAttribute('name', 'circle')
    const mask = document.createElement('div')
    mask.setAttribute('class', 'w-full h-full fixed top-0 left-0 bg-black/50 flex items-center justify-center z-10')
    mask.appendChild(loading)
    document.body.appendChild(mask)
    return {
        removeLoading: () => {
            if (document.body?.contains(mask)) {
                document.body?.removeChild(mask)
            }
        }
    }
}