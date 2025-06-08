import { getAllQueryString } from "ranuts/utils";
import { showLoading } from "./lib/loading";
import { initX2T, handleDocumentOperation } from './lib/x2t'
import { getDocmentObj, setDocmentObj } from "./store";
import './styles/base.css';

const { file } = getAllQueryString();

const { removeLoading } = showLoading()

const getFileName = (res: Response) => {
    // 获取文件名
    let fileName = Math.random().toString(36).substring(2, 15)
    // 2. 如果没有 filename 参数，尝试从 URL 末尾解析
    if (!fileName) {
        const match = decodeURIComponent(file).match(/\/([^\/?#]+)$/)
        if (match && match[1].includes('.')) {
            fileName = match[1]
        }
    }

    // 3. 如果 URL 也解析失败，尝试从 Content-Disposition 响应头获取
    if (!fileName) {
        const disposition = res.headers.get('Content-Disposition')
        if (disposition) {
            const match = disposition.match(/filename\*=UTF-8''(.+)|filename="?([^"]+)"?/)
            if (match) {
                fileName = decodeURIComponent(match[1] || match[2])
            }
        }
    }
    return fileName
}

const onCreateNew = (ext: string) => {
    setDocmentObj({
        fileName: 'New_Document' + ext,
        file: undefined,
    })
    // removeLoading()
}

const onOpenDocument = async () => {
    return new Promise((resolve, reject) => {
        // 创建文件选择器，选择 Office 文档
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.docx,.xlsx,.pptx,.doc,.xls,.ppt'
        document.body.appendChild(input)
        input.onchange = (event) => {
            const file = (event.target as HTMLInputElement).files?.[0]
            if (file) {
                // removeLoading()
                setDocmentObj({
                    fileName: file.name,
                    file: file,
                    url: URL.createObjectURL(file),
                })
                resolve(true)
                document.body.removeChild(input)
            }
        }
    })
}
if (!file) {
    await onOpenDocument()
} else {
    setDocmentObj({
        fileName: Math.random().toString(36).substring(2, 15),
        url: file,
    })
}

try {
    // const docmentObj = getDocmentObj()
    // const res = await fetch(docmentObj.url)
    // const fileName = getFileName(res)
    // if (!res.ok) throw new Error('文件请求失败')
    // const blob = await res.blob()

    // const fileBlob = new File([blob], fileName, { type: blob.type })
    // setDocmentObj({
    //     fileName,
    //     file: fileBlob,
    // })
    await initX2T()
    const { fileName, file: fileBlob } = getDocmentObj()
    await handleDocumentOperation({ file: fileBlob, fileName, isNew: !fileBlob })
    removeLoading()

} catch (error) {
    console.log('error', error);
}

console.log("----", file);