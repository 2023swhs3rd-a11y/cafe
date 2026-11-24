# ☕ 봉일천고 진로카페

선생님들을 위한 진로카페 픽셀 예약 사이트예요. 화면은 **GitHub Pages**에서 열고, 예약 데이터는 지금처럼 구글 시트 **"진로카페 예약"**에 적혀요. 시트와 화면 사이는 시트에 붙은 Apps Script가 이어 줘요.

```
선생님 브라우저 ──▶ GitHub Pages (index.html) ──▶ Apps Script 웹앱 (Code.gs) ──▶ 구글 시트
```

- 카페에 들어가려면 문 앞 도어락에 **네 자리 암호**를 눌러야 해요. 한 번 맞히면 그 기기에서는 기억해요(체크 해제 가능).
- 미리보기: `demo.html` (가짜 이름 데이터, 암호 `1234`, 관리자 비밀번호 `demo`)

## 파일
| 파일 | 하는 일 |
|---|---|
| `index.html` | 카페 화면 (GitHub Pages) |
| `config.js` | Apps Script 웹앱 주소(`CAFE_API`) |
| `demo.html` | 설치 없이 보는 미리보기 |
| `apps-script/Code.gs` | 시트에 붙일 서버 코드 |
| `apps-script/Index.html` | (선택) Apps Script 주소로도 화면을 열고 싶을 때 |
| `OFL.md` | 글꼴 Galmuri11 라이선스 |

## 설치
1. **서버 코드 붙이기**: 구글 시트 → 확장 프로그램 → Apps Script → `Code.gs` 내용을 `apps-script/Code.gs`로 바꾸고 저장. HTML 파일 `Index`도 `apps-script/Index.html`로 바꿔 두면 예전 주소도 그대로 쓸 수 있어요.
2. **암호 정하기**: ⚙️ 프로젝트 설정 → 스크립트 속성
   - `CAFE_CODE` = 입구 네 자리 암호 (예: `0824`). 비워 두면 문이 잠기지 않아요.
   - `ADMIN_PASSWORD` = 관리자 비밀번호 (이미 있으면 그대로)
3. **배포**: 배포 → 배포 관리 → ✏️ → 버전: **새 버전**
   - 실행 사용자: **나**
   - 액세스 권한: **모든 사용자** ← GitHub Pages에서 부르려면 꼭 필요해요
   - 웹 앱 URL(…/exec)이 `config.js`의 주소와 같은지 확인하세요. 다르면 `config.js`를 고쳐요.
4. **GitHub Pages 켜기**: 저장소 Settings → Pages → Source: *Deploy from a branch* → Branch: `main` / `(root)` → Save
5. 몇 분 뒤 `https://2023swhs3rd-a11y.github.io/cafe/` 로 열려요.

## 바꾸고 싶을 때
- **암호 변경**: 스크립트 속성 `CAFE_CODE`만 바꾸면 바로 적용돼요(재배포 필요 없음). 기억해 둔 기기도 다음 요청 때 다시 문 앞으로 돌아가요.
- **카페 규칙·메뉴·마감 시간**: `Code.gs` 맨 위 `CONFIG` (고친 뒤 새 버전 배포)
- **화면**: `index.html` 수정 후 커밋하면 GitHub Pages에 반영돼요.

## 알아 두기
- "모든 사용자" 배포라서 서버 주소를 아는 사람은 학교 밖에서도 요청할 수 있어요. 대신 모든 요청이 입구 암호를 확인하고, 틀리면 거절해요. 암호는 가끔 바꿔 주세요.
- 예약 화면에는 시트처럼 예약자 이름이 보여요. 관리자 화면(맨 아래 "관리자")만 전체 현황과 새 오픈일 만들기가 가능해요.
- 오픈일 닫기: 시트 탭 이름 뒤에 글자를 붙이면(예: `261130(MON) 닫힘`) 사이트에서 사라져요.
