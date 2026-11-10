# 三宗旗舰案件的阶段场景

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

## 新增两宗旗舰案件（2026-11-11）

使用内置 image_gen 编辑各案现有场景。运行文件如下；对应原始 PNG 在已忽略的 `public/assets/orig/`，只提交 WebP。共 4 张、388,148 字节。

| 案件 / 阶段 | 运行时文件 | 公开门控 |
| --- | --- | --- |
| 电梯 / quiet | `public/assets/rainy-elevator.webp` | 初始场景 |
| 电梯 / watched | `public/assets/rainy-elevator-watched.webp` | 玩家已确认男人早知真实楼层 |
| 电梯 / followed | 同 watched，通过取景和光影变化 | 玩家已确认此前尾随 |
| 电梯 / revealed | `public/assets/rainy-elevator-revealed.webp` | 已结案，空电梯门作为揭晓构图，不补写人物去向 |
| 剧院 / quiet | `public/assets/after-curtain.webp` | 初始场景 |
| 剧院 / unpowered | `public/assets/after-curtain-unpowered.webp` | 已确认声音不来自关闭的录音设备，不透露活人 |
| 剧院 / below | `public/assets/after-curtain-below.webp` | 已确认舞台下有活人，不透露身份或求救内容 |
| 剧院 / revealed | 同 below，通过取景和结案字幕变化 | 已结案，不编造获救后续 |

电梯音效采用低频电机余响与短继电器触点；剧院采用低声木质敲击，未确认的信息不会通过节奏或字幕被送出。所有声音继续遵守音乐开关、音量、旁白与同伴发言避让，页面离开后取消。以下是完整提示词；每张图单独调用，编辑目标分别为原始 `rainy-elevator.webp` 或 `after-curtain.webp`。

### rainy-elevator-watched

```text
Use case: precise-object-edit. Asset type: panoramic 16:9 illustrated cinematic background for a Chinese psychological horror deduction game. Edit the supplied reference image, preserving the same antique building, aged walnut wood, weathered brass, rain and painterly photographic realism. Warm amber, brown and near-black palette; no green. Preserve the left 55% and middle as dark negative space for gameplay text and host portrait. No text, numbers, logos, interface, watermark, gore, bodies, faces or supernatural figures. Primary edit: a closer uneasy view of the SAME closed brass elevator door and its small button panel on the right. The illuminated plain round buttons and scratched metal are slightly larger, while the shut umbrella and rainy window remain at the far right edge. The door seam remains fully shut. Focus attention on the panel and narrow door seam, without any floor numerals, portraits, hidden people or tracking evidence. The warm wall lamp is steady and dim. This frame is shown only after the player confirms someone knew a real floor; it must not reveal how.
```

### rainy-elevator-revealed

```text
Use case: precise-object-edit. Asset type: panoramic 16:9 illustrated cinematic background for a Chinese psychological horror deduction game. Edit the supplied reference image, preserving the same antique building, aged walnut wood, weathered brass, rain and painterly photographic realism. Warm amber, brown and near-black palette; no green. Preserve the left 55% and middle as dark negative space for gameplay text and host portrait. No text, numbers, logos, interface, watermark, gore, bodies, faces or supernatural figures. Primary edit: final reveal composition of the SAME old elevator. Its two brass doors have opened enough to show a narrow empty elevator interior and the shadow of its doorway, viewed from the same hallway. No people or silhouettes inside. Preserve the same umbrella, wet floor reflections, right-hand wall lamp, rain-streaked window and aged wood door frame. The button panel glows softly with plain unnumbered circles. Ominous stillness, realistic door geometry, no explicit crime evidence or invented objects. Left 55% remains near-black empty plaster.
```

### after-curtain-unpowered

```text
Use case: precise-object-edit. Asset type: panoramic 16:9 illustrated cinematic horror game background. Edit the supplied old theater image. Preserve SAME torn wine-red velvet curtain, empty wooden seats, antique stage boards and warm walnut/amber painterly photographic realism. No green, no text or symbols, no logos, no people, no gore, no supernatural figures. Primary edit: the wall lamp is switched OFF, with its glass shade dark; faint warm residual ambient light still makes the stage readable. On far right of the stage edge, a small old-fashioned tape recorder sits dark with no lit indicator, power lead visibly disconnected beside it. The theater remains visibly empty, the existing under-stage small service hatch stays closed and unobtrusive. Frame attention on the unpowered recording equipment only after that fact is confirmed. No hand, no signs of a living person beneath stage. Left/central 55% stays very dark negative space for game UI.
```

### after-curtain-below

```text
Use case: precise-object-edit. Asset type: panoramic 16:9 illustrated cinematic horror game background. Edit the supplied old theater image. Preserve SAME torn wine-red velvet curtain, antique wooden stage boards, aged wood service hatch below the stage lip, empty seats, warm walnut/amber painterly photographic realism. No green, no lettering, no symbols, no people, no bodies, no gore, no supernatural figures. Primary edit: a lower, slightly closer camera view focusing on the SAME under-stage closed service hatch at 76% width and the worn stage boards above it. A narrow warm light grazing the timber reveals the hatch outline and deep black seams; there is no visible hand or body and no new scratches, chains, tools or clues. Curtain hem hangs above, first row of empty chairs remains low on the left. Make the space under the stage feel physically deep and enclosed. The left/central 55% stays near-black negative space, highly readable for UI. This is a cinematic framing change only after player confirms a living person is under stage; do not show or invent the victim's identity.
```
