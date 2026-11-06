import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const server=spawn(process.execPath,['e2e/serve.mjs'],{stdio:'ignore',windowsHide:true}); const browser=await chromium.launch(); const page=await browser.newPage({viewport:{width:1440,height:900}}); const out=resolve('../../outputs'); mkdirSync(out,{recursive:true});
try {
 for(let n=0;n<30;n++){try{await page.goto('http://127.0.0.1:4173/index.html');break}catch{await new Promise(r=>setTimeout(r,100))}}
 await page.locator('.app2').waitFor(); await page.locator('.rail-btn[aria-label="자료실"]').click(); await page.getByRole('button',{name:'+ PC 폴더 등록'}).click(); await page.getByRole('button',{name:'+ PC 폴더 등록'}).click(); await page.getByLabel('탐색창 1 등록 폴더').selectOption('root-1'); await page.getByLabel('탐색창 2 등록 폴더').selectOption('root-2'); await page.getByRole('option',{name:'계획.md',exact:true}).waitFor(); await page.screenshot({path:resolve(out,'opus-pc-library.png')});
 await page.locator('.rail-btn[aria-label="개인 프로젝트"]').click(); await page.getByRole('button',{name:'+ 새 카드'}).click(); await page.getByLabel('카드 제목',{exact:true}).fill('개인 프로젝트 정리'); await page.getByLabel('카드 내용',{exact:true}).fill('자료를 정리하고 다음 작업을 계획합니다.'); await page.getByRole('button',{name:'카드 저장'}).click(); await page.screenshot({path:resolve(out,'opus-project-board.png')});
 await page.locator('.rail-btn[aria-label="브라우저"]').click(); await page.screenshot({path:resolve(out,'opus-browser.png')});
} finally { await browser.close(); server.kill() }
