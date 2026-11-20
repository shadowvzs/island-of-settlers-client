/** Original shaded timber bucket, matching the well's staves, iron hoops and visible water. */
export const createWellBucketSymbolSvg = () => `<svg xmlns="http://www.w3.org/2000/svg"
  width="256" height="192" viewBox="0 0 256 192">
  <defs>
    <linearGradient id="timber" x1="0" x2="1">
      <stop stop-color="#754525"/><stop offset=".26" stop-color="#c89b58"/>
      <stop offset=".56" stop-color="#ad7b3e"/><stop offset="1" stop-color="#684024"/>
    </linearGradient>
    <linearGradient id="iron" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#d1d4ce"/><stop offset=".42" stop-color="#8e9693"/>
      <stop offset="1" stop-color="#465553"/>
    </linearGradient>
    <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#70c0d2"/><stop offset="1" stop-color="#267391"/>
    </linearGradient>
  </defs>
  <rect width="256" height="192" rx="10" fill="#e9d5a5"/>
  <ellipse cx="129" cy="163" rx="53" ry="9" fill="#624928" opacity=".22"/>
  <path d="M82 89C70 17 186 17 174 89" fill="none" stroke="#354542"
    stroke-width="9" stroke-linecap="round"/>
  <path d="M82 87C73 20 182 20 174 87" fill="none" stroke="#aeb8af"
    stroke-width="3" stroke-linecap="round"/>
  <path d="M78 83L89 151Q128 171 167 151L178 83Z"
    fill="url(#timber)" stroke="#51351e" stroke-width="3" stroke-linejoin="round"/>
  <path d="M90 87L99 154M107 92L112 160M128 94V163M149 92L144 160M167 87L157 154"
    fill="none" stroke="#5c3b20" stroke-width="2" opacity=".75"/>
  <path d="M95 101L99 125M112 106L113 133M133 108V137M154 106L152 132"
    fill="none" stroke="#e4bc77" stroke-width="1.5" opacity=".48"/>
  <path d="M81 104Q128 124 175 104L173 114Q128 134 83 114Z"
    fill="url(#iron)" stroke="#354541" stroke-width="2"/>
  <path d="M87 141Q128 159 169 141L167 152Q128 171 89 152Z"
    fill="url(#iron)" stroke="#354541" stroke-width="2"/>
  <ellipse cx="128" cy="83" rx="50" ry="16" fill="#b88c4f"
    stroke="#51351e" stroke-width="3"/>
  <ellipse cx="128" cy="83" rx="41" ry="10.5" fill="url(#water)"
    stroke="#604328" stroke-width="3"/>
  <path d="M101 80Q111 76 121 79M130 86Q144 89 155 83" fill="none"
    stroke="#c3e8e5" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M81 86L85 102M175 86L171 102" stroke="#45544f" stroke-width="6"
    stroke-linecap="round"/>
  <circle cx="85" cy="99" r="3" fill="#c6cec5"/>
  <circle cx="171" cy="99" r="3" fill="#c6cec5"/>
</svg>`;
