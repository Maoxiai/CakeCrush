import { _decorator, Component, Node, find, director, profiler, game, Game, Animation, Prefab } from 'cc';
import { AudioManager } from '../../frameworks/audioManager';
import { playerData } from '../../frameworks/playerData';
import { uiManager } from '../../frameworks/uiManager';
import { SceneManager } from '../loading/sceneManager';
import { clientEvent } from '../../frameworks/clientEvent';
import { GameLogic } from '../../frameworks/gameLogic';
import * as i18n from '../../../../extensions/i18n/assets/LanguageData';
import { constants } from '../../shared/constants';
import { localConfig } from '../../frameworks/localConfig';
import { StorageManager } from '../../frameworks/storageManager';
import { resourceUtil } from '../../frameworks/resourceUtil';
import { wxApi } from '../../frameworks/wxApi';
const { ccclass, property } = _decorator;

@ccclass('LoginScene')
export class LoginScene extends Component {
    currentStep: any = null!;
    isLoadCsvFinishd: any = false;

    onLoad () {
        i18n.init('zh');

        profiler.hideStats();

        //初始化平台能力（微信生命周期/菜单分享/冷启动渠道统计）
        GameLogic.instance.init();

        //初始化音频
        AudioManager.instance.init();
        AudioManager.instance.playMusic(constants.AUDIO_MUSIC.BACKGROUND, true);

        //初始化玩家数据
        playerData.instance.loadGlobalCache();
        if (!playerData.instance.userId) {
            playerData.instance.generateRandomAccount();
            console.log("###生成随机userId", playerData.instance.userId);
        }

        //微信登录：获取 code 存档（M2 一期轻量接入，后端登录接口就绪后扩展为 code 换 openid）
        if (wxApi.instance.isWechat) {
            wxApi.instance.login((err: any, code: any) => {
                if (!err && code && playerData.instance.playerInfo) {
                    playerData.instance.playerInfo.wxLoginCode = code;
                    playerData.instance.savePlayerInfoToLocalCache();
                    console.log('###微信登录code已存档', code);
                }
            });
        }

        playerData.instance.loadFromCache();

        if (!playerData.instance.playerInfo || !playerData.instance.playerInfo.createDate) {
            playerData.instance.createPlayerInfo();
        }

        //记录离线时间
        game.on(Game.EVENT_HIDE, () => {
            if (!playerData.instance.settings) {
                playerData.instance.settings = {};
            }

            playerData.instance.settings.hideTime = Date.now();
            playerData.instance.saveAll();
            StorageManager.instance.save();
        })

        //加载CSV相关配置
        localConfig.instance.loadConfig(() => {
            this.isLoadCsvFinishd = true;
        })
    }

    showLoadingUI () {
        var _this = this;
        this.currentStep = 0;
        var loginTimeOut = function () {
            uiManager.instance.showTips(i18n.t("login/timeout"), function () {
                _this.showLoadingUI();
            })
        };
        this.scheduleOnce(loginTimeOut, 30);

        uiManager.instance.showDialog('common/loading');

        SceneManager.instance.load([
            function (cb: any) {
                _this.currentStep = 1;
                _this.loadSubPackage(cb);
            },
            function (cb: any) {
                _this.currentStep = 2;
                _this.loadGameSubPackage(cb);
            },
            function (cb: any) {
                _this.currentStep = 3;
                _this.unschedule(loginTimeOut);
                _this.enterMainScene(cb);
            }
        ], function (err: any, result: any) {
            if (err) {
                console.error(err.message || err);
                return;
            }
        });
    }

    /**
     * 预加载小游戏分包（微信环境）
     * 当前工程资源已全部合并进主包（resources 为 merge_dep/subpackage 整包压缩），
     * 无独立分包时此方法直接通过；后续若为控制首包体积把 gamePackages 拆为分包，
     * 在此处按分包名调用 wx.preDownloadSubpackage / wx.loadSubpackage（按基础库版本二选一）即可
     */
    loadSubPackage (cb: any) {
        let wx = (window as any).wx;
        if (!wx || !wx.loadSubpackage) {
            cb();
            return;
        }

        //分包名与 game.json 的 subpackages 配置一致；当前无分包，占位保留扩展点
        let subpackageNames: string[] = [];
        if (subpackageNames.length === 0) {
            cb();
            return;
        }

        let pending = subpackageNames.length;
        let hasFailed = false;
        subpackageNames.forEach((name) => {
            let task = wx.loadSubpackage({
                name: name,
                success: () => {
                    console.log('###分包加载成功', name);
                },
                fail: (err: any) => {
                    hasFailed = true;
                    console.warn('###分包加载失败', name, err);
                },
                complete: () => {
                    pending--;
                    if (pending === 0) {
                        //分包失败不阻断进游戏流程，主包资源仍可运行
                        cb(hasFailed ? ('subpackage load failed') : null);
                    }
                }
            });
            task && task.onProgressUpdate && task.onProgressUpdate((res: any) => {
                //进度可用于扩展 loading 条：res.progress
            });
        });
    }

    loadGameSubPackage (cb: any) {
        cb();
    }

    enterMainScene (cb: any) {
        var _this = this;
        let targetScene = playerData.instance.isNewBee ? 'fight' : 'pve';
        var onSceneLoaded = function () {
            _this.currentStep = 4;
            cb();

            director.preloadScene(targetScene, function () {
                director.loadScene(targetScene, function () {
                    _this.currentStep = 5;
                    clientEvent.dispatchEvent("onSceneChanged");
                    GameLogic.instance.afterLogin();
                });
            })
        };
        director.preloadScene(targetScene, onSceneLoaded);
    }

    onBtnVisitorLoginClick () {
        if (!this.isLoadCsvFinishd) return;
        this.showLoadingUI();
    }
}