import { Button, Checkbox, Form, Input, Modal, Upload } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { Bot, FolderUp } from 'lucide-react'
import { PendingImageUpload } from '../../AssetImageUpload'
import { filesFromUploadList } from '../digitalHumanHelpers'
import type { DigitalHumanAssetsController } from '../useDigitalHumanAssetsController'
import './DigitalHumanCreateModals.scss'

export function DigitalHumanCreateModals({
  controller,
}: {
  controller: DigitalHumanAssetsController
}) {
  return (
    <>
      <Modal
        className="asset-library-themed-modal"
        footer={null}
        onCancel={() => controller.setChoiceOpen(false)}
        open={controller.choiceOpen}
        title={`添加${controller.label}素材`}
        width={760}
      >
        <div className="digital-human-create-choice-grid">
          <button
            onClick={() => controller.openCreateModal('local')}
            type="button"
          >
            <FolderUp size={58} />
            <strong>本地上传</strong>
            <span>上传已有{controller.label}图片</span>
          </button>
          <button
            onClick={() => controller.openCreateModal('ai')}
            type="button"
          >
            <Bot size={58} />
            <strong>AI生成</strong>
            <span>上传训练照片生成三视图</span>
          </button>
        </div>
      </Modal>
      <Modal
        className="asset-library-themed-modal"
        centered
        footer={
          controller.createMode === 'local'
            ? [
                <Button key="cancel" onClick={controller.closeCreateModal}>
                  取消
                </Button>,
                <Button
                  form="digital-human-local-create-form"
                  htmlType="submit"
                  key="submit"
                  loading={controller.library.isUploading}
                  type="primary"
                >
                  提交素材
                </Button>,
              ]
            : null
        }
        onCancel={controller.closeCreateModal}
        open={controller.createOpen}
        title={
          controller.createMode === 'local'
            ? `本地上传${controller.label}`
            : `AI生成${controller.label}`
        }
        width={controller.createMode === 'local' ? 760 : 1180}
      >
        {controller.createMode === 'local' ? (
          <LocalCreateForm controller={controller} />
        ) : (
          <AiCreateForm controller={controller} />
        )}
      </Modal>
    </>
  )
}

function LocalCreateForm({
  controller,
}: {
  controller: DigitalHumanAssetsController
}) {
  return (
    <Form
      id="digital-human-local-create-form"
      form={controller.createForm}
      labelCol={{ flex: '88px' }}
      layout="horizontal"
      onFinish={(values) => void controller.handleCreate(values.name)}
      wrapperCol={{ flex: 1 }}
    >
      <Form.Item
        label="人像名称"
        name="name"
        rules={[
          {
            required: true,
            whitespace: true,
            message: `请输入${controller.label}名称`,
          },
        ]}
      >
        <Input
          onChange={(event) => controller.setAvatarName(event.target.value)}
          placeholder={`请输入${controller.label}名称`}
          value={controller.avatarName}
        />
      </Form.Item>
      <Form.Item
        help={
          !controller.pendingCreateFiles.length
            ? `请先上传${controller.label}图片`
            : undefined
        }
        label="人像图片"
        required
        style={{ marginBottom: 0 }}
        validateStatus={
          !controller.pendingCreateFiles.length ? 'error' : undefined
        }
      >
        <Upload
          accept="image/*"
          beforeUpload={() => false}
          fileList={controller.createUploadFileList}
          listType="picture-card"
          maxCount={1}
          onChange={({ fileList }) =>
            controller.setPendingCreateFiles(
              filesFromUploadList(fileList).slice(-1),
            )
          }
          onPreview={async (file) => {
            const sourceFile = file.originFileObj as File | undefined
            if (sourceFile)
              controller.setPreviewImage({
                name: file.name,
                src: URL.createObjectURL(sourceFile),
              })
          }}
        >
          {controller.pendingCreateFiles.length >= 1 ? null : (
            <button
              style={{ all: 'unset', cursor: 'pointer', textAlign: 'center' }}
              type="button"
            >
              <PlusOutlined />
              <div style={{ marginTop: 8 }}>上传</div>
            </button>
          )}
        </Upload>
      </Form.Item>
    </Form>
  )
}

function AiCreateForm({
  controller,
}: {
  controller: DigitalHumanAssetsController
}) {
  return (
    <div className="digital-human-create-modal">
      <div className="digital-human-create-left">
        <label className="digital-human-name-row">
          <span>{controller.label}名称：</span>
          <Input
            onChange={(event) => controller.setAvatarName(event.target.value)}
            placeholder={`请输入${controller.label}名称`}
            value={controller.avatarName}
          />
        </label>
        <PendingImageUpload
          files={controller.pendingCreateFiles}
          onChange={controller.setPendingCreateFiles}
          onPreviewFile={controller.setPreviewImage}
        />
        <Checkbox
          checked={controller.agreementChecked}
          onChange={(event) =>
            controller.setAgreementChecked(event.target.checked)
          }
        >
          我已阅读并同意 <a>《使用协议》</a>
        </Checkbox>
        <Button
          className="digital-human-submit"
          disabled={!controller.agreementChecked}
          loading={controller.library.isUploading}
          onClick={() => void controller.handleCreate()}
          type="primary"
        >
          提交照片训练
        </Button>
      </div>
      <div className="digital-human-create-rules">
        <section>
          <h3>照片要求：</h3>
          <ul>
            <li>建议上传全身正面、侧面、背面照片，以及头部正面和侧面近景</li>
            <li>照片格式：JPG、PNG、WEBP</li>
            <li>画面清晰，光线均匀，主体完整无遮挡</li>
            <li>单张照片建议小于 20MB</li>
          </ul>
        </section>
        <section>
          <h3>免责声明：</h3>
          <ul>
            <li>请确认您上传的照片已获得本人或团队授权</li>
            <li>请勿上传涉黄、涉赌、涉毒、政治敏感或其他违法违规内容</li>
            <li>因违规上传或使用导致的法律责任由使用者自行承担</li>
          </ul>
        </section>
        <section className="digital-human-bad-examples">
          <h3>拍摄不佳示例</h3>
          <div>
            {[
              '表情干扰',
              '五官遮挡',
              '拍摄比例',
              '衣着不整',
              '动作干扰',
              '多重人脸',
            ].map((item) => (
              <span key={item}>
                <i>🙂</i>
                <small>{item}</small>
              </span>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
