/**
 * 微信小游戏 SDK 封装层
 * 统一封装：平台判断、生命周期、登录、激励视频/插屏广告、分享、数据统计
 * 所有平台能力均通过 gameLogic 调用本类，非微信环境（浏览器本地调试）自动降级，保证本地可开发
 */
import { constants } from '../shared/constants';

export class wxApi {
    static _instance: wxApi;

    static get instance() {
        if (this._instance) {
            return this._instance;
        }

        this._instance = new wxApi();
        return this._instance;
    }

    private _rewardVideoAd: any = null;
    private _interstitialAd: any = null;

    /** 微信小游戏环境对象（非微信环境返回 null） */
    get wx(): any {
        return (typeof window !== 'undefined' && (window as any).wx) ? (window as any).wx : null;
    }

    /** 当前是否运行在微信小游戏环境 */
    get isWechat(): boolean {
        return !!this.wx;
    }

    /**
     * 初始化微信能力：冷启动参数、前后台切换、右上角菜单分享
     * 在登录场景 onLoad 时调用一次
     */
    init(gameLogic: any) {
        let wx = this.wx;
        if (!wx) {
            return;
        }

        // 冷启动参数（场景值渠道统计）
        let launchOptions = wx.getLaunchOptionsSync();
        if (launchOptions && gameLogic && gameLogic.onAppShow) {
            gameLogic.onAppShow(launchOptions);
        }

        // 前后台切换（渠道统计，小游戏用 wx.onShow，非 onAppShow）
        if (wx.onShow) {
            wx.onShow((res: any) => {
                gameLogic && gameLogic.onAppShow && gameLogic.onAppShow(res);
            });
        }

        // 开启右上角菜单转发，并注册被动分享内容
        if (wx.showShareMenu) {
            wx.showShareMenu({
                withShareTicket: false,
                menus: ['shareAppMessage', 'shareTimeline']
            });
        }
        if (wx.onShareAppMessage) {
            wx.onShareAppMessage(() => {
                return this._getShareContent(constants.SHARE_FUNCTION.PVE);
            });
        }
    }

    /**
     * 微信登录，获取 code（用于后端换取 openid）
     * M2 一期：仅获取 code 存档备用，账号体系仍走本地随机账号，
     * 待后端登录接口就绪后在此扩展 code -> openid 换取逻辑
     */
    login(callback: any) {
        let wx = this.wx;
        if (!wx || !wx.login) {
            callback && callback('not wechat env');
            return;
        }

        wx.login({
            success: (res: any) => {
                callback && callback(null, res.code);
            },
            fail: (err: any) => {
                callback && callback(err);
            }
        });
    }

    /**
     * 展示激励视频广告
     * 非微信环境：直接成功（本地调试方便测试奖励逻辑）
     * 微信环境但广告位未配置：失败（安全兜底，理论上层不会展示看广告入口）
     * @param callback 成功 callback(null)，失败 callback(err)
     */
    showRewardAd(callback: any) {
        let wx = this.wx;
        let adUnitId = constants.WX_AD_CONFIG.REWARD_VIDEO_ID;
        if (!wx) {
            callback && callback(null); // 本地调试：模拟观看成功
            return;
        }

        if (!adUnitId) {
            console.warn('wxApi: REWARD_VIDEO_ID 未配置，请开通流量主后填写广告位ID');
            callback && callback('reward video adUnitId not configured');
            return;
        }

        if (!this._rewardVideoAd) {
            this._rewardVideoAd = wx.createRewardedVideoAd({ adUnitId: adUnitId });
            this._rewardVideoAd.onError((err: any) => {
                console.warn('wxApi: reward video ad error', err);
            });
        }

        // 完整观看才算成功；旧基础库无 isEnded 字段时视为成功
        let onClose = (res: any) => {
            this._rewardVideoAd.offClose(onClose);
            if (!res || res.isEnded || res.isEnded === undefined) {
                callback && callback(null);
            } else {
                callback && callback('reward video not finished');
            }
        };
        this._rewardVideoAd.onClose(onClose);

        this._rewardVideoAd.show().catch(() => {
            // 首次 show 失败（广告未加载），重载后再试一次
            this._rewardVideoAd.load()
                .then(() => this._rewardVideoAd.show())
                .catch((err: any) => {
                    this._rewardVideoAd.offClose(onClose);
                    callback && callback(err);
                });
        });
    }

    /**
     * 展示插屏广告
     * 非微信环境或未配置：直接成功（不打断游戏流程）
     */
    showInterstitialAd(callback: any) {
        let wx = this.wx;
        let adUnitId = constants.WX_AD_CONFIG.INTERSTITIAL_ID;
        if (!wx || !adUnitId) {
            callback && callback(null);
            return;
        }

        if (!this._interstitialAd) {
            this._interstitialAd = wx.createInterstitialAd({ adUnitId: adUnitId });
            this._interstitialAd.onError((err: any) => {
                console.warn('wxApi: interstitial ad error', err);
            });
        }

        this._interstitialAd.show()
            .then(() => callback && callback(null))
            .catch(() => {
                // 失败重载一次
                this._interstitialAd.load()
                    .then(() => this._interstitialAd.show())
                    .then(() => callback && callback(null))
                    .catch((err: any) => callback && callback(err));
            });
    }

    /**
     * 主动发起转发分享
     * 注意：微信新基础库 wx.shareAppMessage 不回调成功/失败（防刷机制），
     * 调用即视为发起成功，延迟回调以兼容原有异步流程
     * @param funStr 分享场景，见 constants.SHARE_FUNCTION
     */
    share(funStr: any, objQuery: any, callback: any) {
        let wx = this.wx;
        if (!wx) {
            callback && callback(null); // 本地调试：模拟分享成功
            return;
        }

        let content = this._getShareContent(funStr);
        wx.shareAppMessage({
            title: content.title,
            imageUrl: content.imageUrl,
            query: this._queryToString(objQuery)
        });

        setTimeout(() => {
            callback && callback(null);
        }, 800);
    }

    /**
     * 获取某个奖励入口的开启方式（看广告 / 分享 / 无）
     * 有激励视频广告位则优先看广告；否则无（上层隐藏对应按钮）
     */
    getOpenRewardType(funStr: any, callback: any) {
        let type = constants.OPEN_REWARD_TYPE.NULL;
        if (!this.isWechat) {
            // 本地调试：返回广告模式，方便测试看广告入口的 UI 与逻辑
            type = constants.OPEN_REWARD_TYPE.AD;
        } else if (constants.WX_AD_CONFIG.REWARD_VIDEO_ID) {
            type = constants.OPEN_REWARD_TYPE.AD;
        }

        callback && callback(null, type);
    }

    /**
     * 数据统计上报（微信自定义分析）
     * 同时 console 输出，便于本地与真机调试核对
     */
    reportAnalytics(eventType: any, objParams?: any) {
        let wx = this.wx;
        if (wx && wx.reportAnalytics) {
            wx.reportAnalytics(eventType, objParams || {});
        }
        console.log('[stat]', eventType, objParams || {});
    }

    /** 根据场景取分享文案 */
    private _getShareContent(funStr: any) {
        let textConfig = constants.SHARE_TEXT;
        let content = textConfig[funStr] || textConfig[constants.SHARE_FUNCTION.PVE];
        return {
            title: content.title,
            imageUrl: content.imageUrl || ''
        };
    }

    /** query 对象转 a=1&b=2 字符串 */
    private _queryToString(objQuery: any) {
        if (!objQuery) {
            return '';
        }

        let arrQuery: string[] = [];
        for (let key in objQuery) {
            if (objQuery.hasOwnProperty(key)) {
                arrQuery.push(key + '=' + objQuery[key]);
            }
        }
        return arrQuery.join('&');
    }
}
