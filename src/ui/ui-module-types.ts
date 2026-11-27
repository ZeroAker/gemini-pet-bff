export interface UiFeatureModule {
  id: string;
  styles: string;
  /** 插入於 <header> 與 <main id="chat"> 之間的頂部區塊（例如進度條、日誌面板、主動關懷氣泡） */
  topHtml?: string;
  /** 插入於 <footer> 之後的彈窗區塊（Modal） */
  modalHtml?: string;
  /** 該功能專屬的前端 JS 程式碼 */
  script: string;
}

export interface UiCoreSkeletonModule extends UiFeatureModule {
  headerHtml: string;
  mainHtml: string;
  footerHtml: string;
}
