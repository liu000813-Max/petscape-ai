'use client';

import React, { useId, useRef, useState } from 'react';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function validateFiles(files) {
  if (!files || files.length === 0) return null;
  if (files.length !== 1) return '一次只能上传一张图片';

  const file = files[0];
  if (!file.type || !file.type.startsWith('image/')) return '请上传图片文件';
  if (file.size > MAX_IMAGE_BYTES) return '图片不能超过 10MB';
  return null;
}

export function ImageDropzone({
  previewUrl,
  alt = '图片预览',
  emptyContent,
  onFile,
  className = '',
  imageClassName = '',
  inputClassName = '',
  statusClassName = '',
  disabled = false,
  busyLabel = '上传中…',
  dragLabel = '松开上传图片',
  chooseLabel = '选择图片',
  replaceLabel = '重新上传',
  showActionLabel = false,
  children = null,
  ...rest
}) {
  const statusId = useId();
  const inputRef = useRef(null);
  const dragDepthRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isDisabled = disabled || busy;

  async function processFiles(fileList) {
    const files = Array.from(fileList || []);
    const validationError = validateFiles(files);
    if (validationError) {
      setError(validationError);
      return;
    }

    setBusy(true);
    setError('');
    try {
      await onFile(files[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setBusy(false);
    }
  }

  function openPicker() {
    if (!isDisabled) inputRef.current?.click();
  }

  function handleInputChange(event) {
    void processFiles(event.target.files);
    event.target.value = '';
  }

  function handleDragEnter(event) {
    event.preventDefault();
    event.stopPropagation();
    if (isDisabled) return;
    dragDepthRef.current += 1;
    setDragging(true);
  }

  function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    if (!isDisabled) event.dataTransfer.dropEffect = 'copy';
  }

  function handleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    if (isDisabled) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragging(false);
  }

  function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setDragging(false);
    if (!isDisabled) void processFiles(event.dataTransfer.files);
  }

  const statusText = busy ? busyLabel : dragging ? dragLabel : error;

  return (
    <>
      <button
        type="button"
        className={`image-dropzone ${dragging ? 'is-dragging' : ''} ${busy ? 'is-busy' : ''} ${error ? 'has-error' : ''} ${className}`}
        onClick={openPicker}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        disabled={isDisabled}
        aria-busy={busy}
        aria-invalid={error ? true : undefined}
        aria-describedby={(statusText || showActionLabel) ? statusId : undefined}
        {...rest}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={alt} className={imageClassName} />
        ) : (
          emptyContent
        )}
        {children}
        {(statusText || showActionLabel) && (
          <span
            id={statusId}
            className={`image-dropzone-status ${error ? 'is-error' : ''} ${busy || dragging ? 'is-active' : ''} ${statusClassName}`}
            role={error ? 'alert' : 'status'}
            aria-live={error ? 'assertive' : 'polite'}
          >
            {statusText || (previewUrl ? replaceLabel : chooseLabel)}
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className={inputClassName}
        onChange={handleInputChange}
        disabled={isDisabled}
        tabIndex={-1}
        style={{ display: 'none' }}
      />
    </>
  );
}
