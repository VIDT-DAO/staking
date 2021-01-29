const Staking = artifacts.require('./Staking.sol');
const Deposits = artifacts.require('./Deposits.sol');
const ERC20 = artifacts.require('./ERC20Mock.sol');
const { waitUntilBlock } = require('./helpers/tempo')(web3);

contract('Staking', ([owner, alice, bob, carl]) => {
    before(async () => {
        this.erc20 = await ERC20.new("Mock token", "MOCK", 0, 1000000);
        let balance = await this.erc20.balanceOf(owner);
        assert.equal(balance.valueOf(), 1000000);
    });

    before(async () => {
        this.token1 = await ERC20.new("Token 1", "T1", 0, 0);

        await Promise.all([
            this.token1.mint(alice, 5000),
            this.token1.mint(bob, 500),
            this.token1.mint(carl, 2000),
        ]);

        const [balanceAlice, balanceBob, balanceCarl] = await Promise.all([
            this.token1.balanceOf(alice),
            this.token1.balanceOf(bob),
            this.token1.balanceOf(carl),
        ]);

        assert.equal(5000, balanceAlice);
        assert.equal(500, balanceBob);
        assert.equal(2000, balanceCarl);
    });

    before(async () => {
        this.token2 = await ERC20.new("Token 2", "T2", 0, 0);

        await Promise.all([
            this.token2.mint(alice, 1500),
            this.token2.mint(bob, 800),
        ]);

        const [balanceAlice, balanceBob, balanceCarl] = await Promise.all([
            this.token2.balanceOf(alice),
            this.token2.balanceOf(bob),
            this.token2.balanceOf(carl),
        ]);

        assert.equal(1500, balanceAlice);
        assert.equal(800, balanceBob);
        assert.equal(0, balanceCarl);
    });

    before(async () => {
        this.deposits = await Deposits.new();

        const currentBlock = await web3.eth.getBlockNumber();
        this.startBlock = currentBlock + 100;

        this.staking = await Staking.new(
            this.deposits.address,
            this.erc20.address,
            this.startBlock,
            this.startBlock + 1000,  // End block
            this.startBlock + 600    // Soft lock
        );

        await Promise.all([
            this.staking.add(this.token1.address, 1, 1000),
            this.staking.add(this.token2.address, 2, 500)
        ]);

        await this.deposits.trust(this.staking.address);

        await this.erc20.approve(this.staking.address, 10000);
    });

    describe('when created', () => {
        it('is linked to the Mock ERC20 token', async () => {
            const linked = await this.staking.erc20();
            assert.equal(linked, this.erc20.address);
        });

        it('is configured with the correct start block, end block, and soft lock block', async () => {
            const startBlock = await this.staking.startBlock();
            const endBlock = await this.staking.endBlock();
            const softLockBlock = await this.staking.softLockBlock();

            assert.equal(startBlock, this.startBlock);
            assert.equal(endBlock, this.startBlock + 1000);
            assert.equal(softLockBlock, this.startBlock + 600);
        });

        it('is initialized for 2 token pools', async () => {
            const poolLength = await this.staking.poolLength();
            assert.equal(2, poolLength);

            const poolInfo1 = await this.staking.poolInfo(0);
            assert.equal(poolInfo1.token, this.token1.address);
            assert.equal(poolInfo1.rewardPerToken, 0.001e36);

            const poolInfo2 = await this.staking.poolInfo(1);
            assert.equal(poolInfo2.token, this.token2.address);
            assert.equal(poolInfo2.rewardPerToken, 0.004e36);
        });
    });

    describe('before the start block', () => {
        before(async () => {
            await Promise.all([
                this.token1.approve(this.deposits.address, 1500, {from: alice}),
                this.token1.approve(this.deposits.address, 500, {from: bob})
            ]);

            await Promise.all([
                this.deposits.deposit(this.token1.address, 1500, {from: alice}),
                this.deposits.deposit(this.token1.address, 500, {from: bob})
            ]);
        });

        it('does not assign any rewards yet', async () => {
            const pendingAlice = await this.staking.pending(alice);
            assert.equal(0, pendingAlice);

            const pendingBob = await this.staking.pending(bob);
            assert.equal(0, pendingBob);
        });
    })

    describe('only allows actions to be done by the contract owner', () => {
        it('won\'t allow alice to add a token pool', async () => {
            try {
                await this.staking.add(this.erc20.address, 100, 1, {from: alice});
            } catch (ex) {
                assert.equal(ex.receipt.status, '0x0');
                return;
            }
            assert.fail('transaction should not have been successful');
        });

        it('won\'t allow alice to extend the staking program', async () => {
            try {
                await this.staking.extend(1000, {from: alice});
            } catch (ex) {
                assert.equal(ex.receipt.status, '0x0');
                return;
            }
            assert.fail('transaction should not have been successful');
        });

        it('won\'t allow alice to terminate the staking program', async () => {
            try {
                await this.staking.terminate({from: alice});
            } catch (ex) {
                assert.equal(ex.receipt.status, '0x0');
                return;
            }
            assert.fail('transaction should not have been successful');
        });
    });

    describe('after 10 blocks of staking', () => {
        before(async () => {
            await waitUntilBlock(10, this.startBlock + 10);
        });

        it('has a pending reward for alice and bob', async () => {
            const pendingAlice = await this.staking.pending(alice);
            assert.equal(15, pendingAlice);

            const pendingBob = await this.staking.pending(bob);
            assert.equal(5, pendingBob);
        });
    });

    describe('with a 3th participant', () => {
        before(async () => {
            await waitUntilBlock(10, this.startBlock + 28);

            await this.token1.approve(this.deposits.address, 2000, {from: carl});
            await this.deposits.deposit(this.token1.address, 2000, {from: carl});
        });

        it('has a pending reward for alice and bob, but not yet for carl', async () => {
            const pendingAlice = await this.staking.pending(alice);
            assert.equal(45, pendingAlice);

            const pendingBob = await this.staking.pending(bob);
            assert.equal(15, pendingBob);

            const pendingCarl = await this.staking.pending(carl);
            assert.equal(0, pendingCarl);
        });
    });

    describe('after 50 blocks of staking', () => {
        before(async () => {
            await waitUntilBlock(10, this.startBlock + 50);
        });

        it('has a pending reward for alice, bob, and carl', async () => {
            const pendingAlice = await this.staking.pending(alice);
            assert.equal(75, pendingAlice);

            const pendingBob = await this.staking.pending(bob);
            assert.equal(25, pendingBob);

            const pendingCarl = await this.staking.pending(carl);
            assert.equal(40, pendingCarl);
        });
    });

    describe('with a participant withdrawing', () => {
        before(async () => {
            await waitUntilBlock(10, this.startBlock + 69);
            await this.staking.withdraw({from: alice});
        });

        it('gives alice her deposit and reward', async () => {
            const balanceERC20 = await this.erc20.balanceOf(alice);
            assert.equal(105, balanceERC20);

            const balance1 = await this.token1.balanceOf(alice);
            assert.equal(5000, balance1);
        });

        it('has no deposit for alice', async () => {
            const deposited = await this.deposits.deposited(this.token1.address, alice);
            assert.equal(0, deposited);
        });

        it('has stored the amount that was paid out', async () => {
            const paidOut = await this.staking.paidOut();
            assert.equal(105, paidOut);
        });

        it('has taken the tokens from the contract owner', async () => {
            const balanceOwner = await this.erc20.balanceOf(owner);
            assert.equal(1000000 - 105, balanceOwner);
        });

        it('has a pending reward for bob and carl, but not for alice', async () => {
            const pendingAlice = await this.staking.pending(alice);
            assert.equal(0, pendingAlice);

            const pendingBob = await this.staking.pending(bob);
            assert.equal(35, pendingBob);

            const pendingCarl = await this.staking.pending(carl);
            assert.equal(80, pendingCarl);
        });
    });

    describe('with a participant using a boost by depositing token 2', () => {
        before(async () => {
            await waitUntilBlock(10, this.startBlock + 98);

            await this.token2.approve(this.deposits.address, 500, {from: bob});
            await this.deposits.deposit(this.token2.address, 500, {from: bob});

            await waitUntilBlock(10, this.startBlock + 110);
        });

        it('rewards bob for the deposited token 2', async () => {
            const pendingBob = await this.staking.pending(bob);
            assert.equal(75, pendingBob);
        });
    });

    describe('while running', () => {
        it('is not possible to add a token pool', async () => {
            try {
                await this.staking.add(this.erc20.address, 1, 1);
            } catch (ex) {
                assert.equal(ex.receipt.status, '0x0');
                return;
            }
            assert.fail('transaction should not have been successful');
        });

        it('is not possible to harvest rewards', async () => {
            try {
                await this.staking.harvest({from: alice});
            } catch (ex) {
                assert.equal(ex.receipt.status, '0x0');
                return;
            }
            assert.fail('transaction should not have been successful');
        });

        it('the program can be extended', async () => {
            await this.staking.extend(500);

            const endBlock = await this.staking.endBlock();
            assert.equal(this.startBlock + 1500, endBlock);
        });
    });

    describe('when terminated', () => {
        before(async () => {
            await waitUntilBlock(10, this.startBlock + 199);
            await this.staking.terminate();
        })

        it('the program has ended', async () => {
            const newEndBlock = await this.staking.endBlock();
            assert.equal(newEndBlock, this.startBlock + 200);
        });

        it('it is not possible to extend the program', async () => {
            try {
                await this.staking.extend(500);
            } catch (ex) {
                assert.equal(ex.receipt.status, '0x0');
                return;
            }
            assert.fail('transaction should not have been successful');
        });
    });


    describe('with a participant harvesting the ended program', () => {
        before(async () => {
            await waitUntilBlock(100, this.startBlock + 499);
            await this.staking.harvest({from: bob});
        });

        it('gives bob his reward', async () => {
            const balanceERC20 = await this.erc20.balanceOf(bob);
            assert.equal(300, balanceERC20);
        });

        it('did not change bob\'s deposits', async () => {
            const deposit1 = await this.deposits.deposited(this.token1.address, bob)
            const balance1 = await this.token1.balanceOf(bob);
            assert.equal(500, deposit1);
            assert.equal(0, balance1);

            const deposit2 = await this.deposits.deposited(this.token2.address, bob)
            const balance2 = await this.token2.balanceOf(bob);
            assert.equal(500, deposit2);
            assert.equal(300, balance2);
        });

        it('has stored the amount that was paid out', async () => {
            const paidOut = await this.staking.paidOut();
            assert.equal(405, paidOut);
        });

        it('has taken the tokens from the contract owner', async () => {
            const balanceOwner = await this.erc20.balanceOf(owner);
            assert.equal(1000000 - 405, balanceOwner);
        });

        it('has a pending reward for carl, but not for bob and alice', async () => {
            const pendingAlice = await this.staking.pending(alice);
            assert.equal(0, pendingAlice);

            const pendingBob = await this.staking.pending(bob);
            assert.equal(0, pendingBob);

            const pendingCarl = await this.staking.pending(carl);
            assert.equal(340, pendingCarl);
        });

        it('it will not allow alice to harvest', async () => {
            try {
                await this.staking.harvest({from: alice});
            } catch (ex) {
                assert.equal(ex.receipt.status, '0x0');
                return;
            }
            assert.fail('transaction should not have been successful');
        });

        it('it will not allow bob to harvest twice', async () => {
            try {
                await this.staking.harvest({from: bob});
            } catch (ex) {
                assert.equal(ex.receipt.status, '0x0');
                return;
            }
            assert.fail('transaction should not have been successful');
        });
    });
});
