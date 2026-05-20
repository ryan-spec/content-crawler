# Reddit Shorts Automation V3: Segment-Based Content Architecture

Chào mừng bạn đến với phiên bản **V3 Segment-Based Content Architecture**! 

Hệ thống đã được tái cấu trúc hoàn chỉnh từ việc tạo kịch bản/audio nguyên khối (monolithic) sang kiến trúc **phân mảnh theo phân đoạn kể chuyện (modular segment-based content)**. Thiết kế này tối ưu hóa độ giữ chân người xem (audience retention) cho YouTube Shorts, TikTok, cũng như mở ra khả năng tự động render bằng **FFmpeg** và dựng luồng làm việc trên **CapCut**.

---

## 1. Tổng Quan Kiến Trúc Mới

Thay vì lưu trữ rời rạc các file kịch bản, âm thanh phẳng, mỗi câu chuyện Reddit giờ đây sẽ là một thư mục đóng gói khép kín tại:
```
data/stories/{story_id}/
```

Mỗi thư mục câu chuyện chứa cấu trúc phân lớp chuyên biệt sau:
* **`/raw`**: Chứa dữ liệu gốc thu thập từ Reddit API (`story.json`).
* **`/processed`**: Kịch bản được phân mảnh thành các đoạn kể chuyện bằng tiếng Việt (`segments.json`).
* **`/audio`**: Các tệp âm thanh tương ứng với từng phân đoạn dạng `index_segmentId.mp3` (Đa giọng đọc).
* **`/subtitles`**: Phụ đề tự động đồng bộ theo thời gian dạng `index_segmentId.srt` (TikTok-style snappy captions).
* **`/metadata`**: Bảng dữ liệu đồng bộ dòng thời gian kịch bản (`timeline.json`).
* **`/render`**: Thư mục chuẩn bị sẵn để chứa thành phẩm video render, meme assets, template CapCut.

---

## 2. Cấu Trúc File & JSON Schema Chi Tiết

### A. Raw Data (`/raw/story.json`)
Lưu trữ thông tin gốc của Reddit bao gồm tiêu đề, nội dung, điểm số, tác giả, subreddit và danh sách bình luận đã cào.

### B. Processed Segments (`/processed/segments.json`)
Kịch bản tiếng Việt được viết lại hoàn toàn thành các phân cảnh kịch tính ngắn (15-40 từ mỗi segment) để tối ưu nhịp thở và phụ đề:
```json
{
  "segments": [
    {
      "id": "hook",
      "type": "hook",
      "text": "Tôi thật sự chết lặng khi phát hiện bí mật mà chồng giấu kín suốt 5 năm qua...",
      "voice": "banmai",
      "speed": "0"
    },
    {
      "id": "story_1",
      "type": "story",
      "text": "Mọi chuyện bắt đầu từ lúc tôi dọn dẹp căn gác mái...",
      "voice": "banmai",
      "speed": "0"
    },
    {
      "id": "comment_intro",
      "type": "transition",
      "text": "Nhưng comment nhiều like nhất trên Reddit lại nói...",
      "voice": "banmai",
      "speed": "0"
    },
    {
      "id": "comment_1",
      "type": "comment",
      "text": "Nghe giống như anh ta đang thao túng tâm lý bạn hơn là hôn nhân đấy, hãy chạy ngay đi!",
      "voice": "leminh",
      "speed": "0"
    },
    {
      "id": "ending",
      "type": "ending",
      "text": "Có lẽ tôi chưa bao giờ thật sự biết anh ấy là ai...",
      "voice": "banmai",
      "speed": "-1"
    }
  ]
}
```

Các loại phân đoạn (`type`) được hỗ trợ:
- `hook`: Thu hút người xem trong 3 giây đầu tiên.
- `story`: Diễn biến câu chuyện chính.
- `transition`: Cầu nối kịch tính dẫn vào bình luận của cộng đồng.
- `comment`: Phản ứng chân thực, thô mộc của internet.
- `ending`: Kết thúc lắng đọng, suy tư.
- `question`: Câu hỏi khơi gợi bình luận phán xét.
- `reveal`: Tiết lộ bất ngờ (plot twist).

### C. Metadata Timeline (`/metadata/timeline.json`)
Bản đồ thời gian hoàn chỉnh để ghép nối các tài nguyên âm thanh và phụ đề trong quá trình render tự động:
```json
[
  {
    "segment_id": "hook",
    "type": "hook",
    "text": "Tôi thật sự chết lặng khi phát hiện bí mật mà chồng giấu kín suốt 5 năm qua...",
    "audio": "01_hook.mp3",
    "subtitle": "01_hook.srt",
    "estimated_duration": 6.3,
    "voice": "banmai",
    "speed": "0"
  },
  {
    "segment_id": "comment_1",
    "type": "comment",
    "text": "Nghe giống như anh ta đang thao túng tâm lý bạn hơn là hôn nhân đấy, hãy chạy ngay đi!",
    "audio": "04_comment_1.mp3",
    "subtitle": "04_comment_1.srt",
    "estimated_duration": 5.2,
    "voice": "leminh",
    "speed": "0"
  }
]
```

---

## 3. Các Điểm Cải Tiến Đột Phá

### 1. Đồng Bộ Phụ Đề TikTok-Style Tự Động
Mỗi phân đoạn có một tệp phụ đề `.srt` riêng biệt nằm trong `/subtitles`. 
* Kịch bản tự động được chia nhỏ thành các cụm từ ngắn từ **3 đến 4 từ**.
* Các dòng phụ đề này được chia đều (synchronize) một cách mượt mà theo đúng tổng thời lượng phát âm thực tế của tệp âm thanh phân đoạn đó.
* Kết quả cho ra những dòng chữ hiện lên nhanh, giật gọn gàng cực kỳ bắt mắt chuẩn phong cách video ngắn thịnh hành.

### 2. Multi-Voice & Giọng Đọc Đa Dạng
TTS Flow đã được nâng cấp hỗ trợ chuyển đổi linh hoạt:
* **Narrator** (Giọng kể chuyện chính): Mặc định sử dụng giọng nữ truyền cảm `banmai` hoặc giọng nam ấm áp `leminh` với tốc độ chuẩn (`speed: 0`).
* **Commenters** (Giọng cư dân mạng phản ứng): Tự động đổi giới tính so với Narrator để tạo tương tác tương phản (ví dụ: Narrator là nữ thì Commenter là nam `minhquang` và ngược lại). Việc đổi giọng giúp video sinh động, không bị nhàm chán và người nghe phân biệt được rõ ràng đâu là lời kể, đâu là bình luận phản hồi.
* **Pacing Emotive Ending** (Kết thúc chậm lắng đọng): Đoạn `ending` và `question` được thiết lập tốc độ đọc chậm hơn (`speed: -1`) giúp lời thú nhận có chiều sâu và kích thích bình luận tối đa.

### 3. Comment Decision System (Quyết Định Bình Luận Động)
Hệ thống sử dụng hàm thông minh `shouldUseComments(story)` để chỉ tích hợp bình luận khi:
* Subreddit thuộc thể loại thảo luận/drama sâu sắc như `r/AmItheAsshole`, `r/relationship_advice`, `r/MaliciousCompliance`, `r/tifu`, `r/confession`.
* Các bình luận phải có chất lượng cao (điểm số cao hoặc đạt tối thiểu 5% độ tương tác so với bài gốc).
* Giúp loại bỏ những bình luận rác, nhạt nhẽo hoặc lặp ý, đảm bảo mạch kịch bản luôn gay cấn nhất.

---

## 4. Hướng Dẫn Tích Hợp Luồng Sản Xuất (FFmpeg & CapCut)

### A. Quy Trình Import Thủ Công Vào CapCut / Premiere
1. Tạo một project mới trên điện thoại hoặc máy tính.
2. Kéo toàn bộ file âm thanh trong thư mục `/audio` vào timeline theo thứ tự số thứ tự tăng dần (`01_hook.mp3`, `02_story.mp3`, ...).
3. Import các tệp `.srt` tương ứng trong thư mục `/subtitles` vào. CapCut sẽ tự động đặt phụ đề khớp hoàn hảo với từng đoạn thoại.
4. Áp dụng template style chữ động (TikTok/Shorts captions) cho toàn bộ phụ đề chỉ bằng 1-click.
5. Thêm nhạc nền lofi hoặc nhạc kịch tính phía sau, và chèn video gameplay nền (Minecraft, GTA5) là video đã sẵn sàng xuất bản!

### B. Ý Tưởng Tự Động Hóa Với FFmpeg (Auto-Rendering)
Nếu muốn phát triển công cụ tự động tạo video 100%, bạn có thể viết một script đọc tệp `/metadata/timeline.json` để thực hiện:
1. **Ghép nối âm thanh**:
   ```bash
   ffmpeg -i 01_hook.mp3 -i 02_story.mp3 -i 03_transition.mp3 -filter_complex "[0:a][1:a][2:a]concat=n=3:v=0:a=1[outa]" -map "[outa]" output.mp3
   ```
2. **Ghép nối phụ đề và vẽ chữ đè lên video nền gameplay**:
   FFmpeg hỗ trợ render subtitle trực tiếp thông qua filter `subtitles`:
   ```bash
   ffmpeg -i gameplay.mp4 -vf "subtitles=01_hook.srt:force_style='Alignment=6,FontSize=16,PrimaryColour=&H00FFFF&'" -c:v libx264 output_scene1.mp4
   ```
3. **Cắt dựng gameplay tự động**: Sử dụng trường `estimated_duration` của từng phân đoạn trong timeline để cắt chính xác độ dài video nền tương ứng, kết hợp hiệu ứng Zoom nhấp nháy chuyển cảnh giữa mỗi phân đoạn (`transition` / `comment` / `reveal`).

---

Chúc bạn tạo ra những sản phẩm Shorts triệu view chất lượng và ấn tượng nhất!
