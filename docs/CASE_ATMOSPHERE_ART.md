# 《第二个蛋糕》阶段场景

使用内置 image_gen 编辑现有场景，无额外图像 API 密钥。原图 `public/assets/second-cake.webp`；运行时只使用压缩后的 WebP，原始 PNG 保存在已忽略的 `public/assets/orig/`。

| 阶段 | 文件 | 触发条件 |
| --- | --- | --- |
| 初始 / 确认有人 | `public/assets/second-cake-quiet.webp` | 初始无门锁暗示，确认有人后才出现环境变化 |
| 确认无法自由离开 | `public/assets/second-cake-locked.webp` | 服务端返回 locked |
| 真相揭晓 | `public/assets/second-cake-revealed.webp` | 本局结束，服务端返回 revealed |

图片不会提前说明人物身份。所有分阶段音效由 Web Audio 合成，跟随音乐开关和音量，页面隐藏或离开推理时停止；减少动态效果设置下不做场景闪动。

## quiet

```text
Use case: precise-object-edit. Asset type: warm sepia cinematic illustrated background for a Chinese psychological horror deduction game. Edit target is the supplied original second-cake room image. Preserve its exact antique walnut table, TWO matching small ivory birthday cakes with extinguished candles, wall lamp, cracked warm brown plaster, heavy dark wooden door and painterly photographic realism. Preserve 16:9 panoramic composition and left/central dark negative space so game UI stays readable. Warm amber and walnut palette only, no green, no gore, no lettering, no UI, no watermarks. Keep all subject matter in the right half. Primary edit: at the START of the mystery, the heavy wooden door is closed with only an ordinary unobtrusive knob. Remove the external padlock AND external bolt entirely, naturally reconstruct matching wooden door boards. Keep the entire rest of the image unchanged. The lamp burns steadily, the cakes remain untouched, only quiet dread.
```

## locked

```text
Use case: precise-object-edit. Asset type: warm sepia cinematic illustrated background for a Chinese psychological horror deduction game. Edit target is the supplied original second-cake room image. Preserve its exact antique walnut table, TWO matching small ivory birthday cakes with extinguished candles, wall lamp, cracked warm brown plaster, heavy dark wooden door and painterly photographic realism. Preserve 16:9 panoramic composition and left/central dark negative space so game UI stays readable. Warm amber and walnut palette only, no green, no gore, no lettering, no UI, no watermarks. Keep all subject matter in the right half. Primary edit: a later shot after the player has confirmed confinement. Move the camera closer to the same heavy closed wooden door, with an aged exterior iron bolt and locked small brass padlock rendered clearly at around 70% of image width and 45% height. The lamp is near upper right. Keep two identical cakes small in bottom-right foreground on the same table, partially cropped, not the hero. Stronger low amber side light reveals worn wood and scratches near the lock; the left 58% of image remains very dark empty cracked wall with no subjects. Psychological dread, believable physical geometry, no people or silhouettes.
```

## revealed

```text
Use case: precise-object-edit. Asset type: warm sepia cinematic illustrated background for a Chinese psychological horror deduction game. Edit target is the supplied original second-cake room image. Preserve its exact antique walnut table, TWO matching small ivory birthday cakes with extinguished candles, wall lamp, cracked warm brown plaster, heavy dark wooden door and painterly photographic realism. Preserve 16:9 panoramic composition and left/central dark negative space so game UI stays readable. Warm amber and walnut palette only, no green, no gore, no lettering, no UI, no watermarks. Keep all subject matter in the right half. Primary edit: final reveal shot. The SAME heavy wooden door is now open a narrow angle into a pitch-dark small room, external bolt released and padlock hanging open. The opening is at 67% of image width. There is a worn empty wooden chair just barely discernible beyond, no people, no faces. In foreground the SAME two matching small birthday cakes with extinguished candles remain at bottom right. Dim amber wall lamp illuminates the door edge and lock. Strong stillness, ominous aftermath, no gore or explicit harm. Left 58% stays dark negative space.
```
